/**
 * Streaming Volume Data
 * For very large volumes (>2GB), reads slices on-demand from file
 * Never loads full volume into memory
 */
class StreamingVolumeData {
    constructor(metadata, file, blockBoundaries) {
        this.metadata = metadata;
        this.dimensions = metadata.dimensions;
        this.dataType = metadata.dataType;
        this.spacing = metadata.spacing || [1.0, 1.0, 1.0];
        this.file = file;
        this.blockBoundaries = blockBoundaries;

        // Track which blocks are "active" (for API compatibility)
        this.activeBlocks = new Set();
        this.isFullyLoaded = false;
        this.isStreaming = true;

        // Low-res volume for quick access
        this.lowResVolume = null;
        this.lowResScale = 4;

        // Min/max from low-res sampling
        this.min = 0;
        this.max = 1;

        // Slice cache (LRU-style, limited size)
        // Uses Map insertion order for LRU tracking (delete + re-set moves to end)
        // ~4MB per slice for 1004x1004 float, 100 slices = ~400MB max cache
        this.sliceCache = new Map();
        this.maxCachedSlices = 100;

        // Prefetch settings
        this.prefetchRadius = 10; // Prefetch 10 slices ahead/behind
        this.prefetchInProgress = new Set();
        this.maxConcurrentPrefetch = 4;

        // Callback when a slice becomes available (for re-rendering)
        this.onSliceReady = null;
        this.onXZSliceReady = null;
        this.onYZSliceReady = null;

        // Current high-res XZ/YZ slices (only cache one each)
        this.currentXZSlice = null;
        this.currentXZIndex = -1;
        this.currentYZSlice = null;
        this.currentYZIndex = -1;
        this.xzLoadInProgress = false;
        this.yzLoadInProgress = false;

        // Calculate byte sizes
        this.bytesPerVoxel = this.getBytesPerVoxel(this.dataType);
        const [nx, ny, nz] = this.dimensions;
        this.sliceSize = nx * ny * this.bytesPerVoxel;

        // Serialized I/O queue — only one blob read in-flight at a time.
        // Concurrent reads compete for browser I/O and each takes ~50% longer.
        this._readQueue = Promise.resolve();

        // When true, skip all async file reads (used in hybrid preview mode
        // where full data will be available shortly)
        this.disableAsyncLoads = false;
    }

    getBytesPerVoxel(dataType) {
        switch (dataType.toLowerCase()) {
            case 'uint8': return 1;
            case 'uint16': return 2;
            case 'float':
            case 'float32': return 4;
            default: return 4;
        }
    }

    setLowResData(lowResVolume, min, max) {
        this.lowResVolume = lowResVolume;
        this.min = min;
        this.max = max;
    }

    /**
     * Get data for histogram calculation
     * Returns low-res data since full data isn't in memory
     */
    get data() {
        if (this.lowResVolume && this.lowResVolume.data) {
            return this.lowResVolume.data;
        }
        // Return empty array if low-res not ready yet
        return new Float32Array(0);
    }

    activateBlock(blockIndex) {
        this.activeBlocks.add(blockIndex);
    }

    markFullyLoaded() {
        this.isFullyLoaded = true;
    }

    /**
     * Get a 2D slice from the volume
     * For XY slices: reads from file on-demand with caching
     * For XZ/YZ slices: uses low-res data (too many file reads otherwise)
     */
    getSlice(axis, index) {
        const [nx, ny, nz] = this.dimensions;

        switch (axis.toLowerCase()) {
            case 'xy':
                return this.getXYSlice(index, nx, ny, nz);
            case 'xz':
                return this.getXZSliceLowRes(index, nx, ny, nz);
            case 'yz':
                return this.getYZSliceLowRes(index, nx, ny, nz);
            default:
                throw new Error(`Invalid axis: ${axis}`);
        }
    }

    /**
     * Get XY slice - reads from file with caching
     */
    async getXYSliceAsync(z, nx, ny, nz) {
        if (z < 0 || z >= nz) {
            throw new Error(`Slice index ${z} out of bounds [0, ${nz})`);
        }

        // Check cache first
        const cacheKey = `xy_${z}`;
        if (this.sliceCache.has(cacheKey)) {
            // Move to end of Map (most recently used)
            const value = this.sliceCache.get(cacheKey);
            this.sliceCache.delete(cacheKey);
            this.sliceCache.set(cacheKey, value);
            return value;
        }

        // Read slice from file
        const tRead = performance.now();
        const sliceStart = z * this.sliceSize;
        const sliceEnd = sliceStart + this.sliceSize;
        const sliceBlob = this.file.slice(sliceStart, sliceEnd);
        const sliceBuffer = await this.readBlob(sliceBlob);
        const sliceData = this.bufferToTypedArray(sliceBuffer, this.dataType);
        console.log(`[XY z=${z}] read: ${(performance.now() - tRead).toFixed(1)}ms (${(this.sliceSize / 1024 / 1024).toFixed(1)}MB)`);

        const result = {
            data: sliceData,
            width: nx,
            height: ny
        };

        // Add to cache
        this.addToCache(cacheKey, result);

        // Notify listener that slice is ready (for re-rendering)
        if (this.onSliceReady) {
            this.onSliceReady(z);
        }

        return result;
    }

    /**
     * Synchronous XY slice - returns cached or low-res upscaled
     */
    getXYSlice(z, nx, ny, nz) {
        if (z < 0 || z >= nz) {
            throw new Error(`Slice index ${z} out of bounds [0, ${nz})`);
        }

        // Check cache first
        const cacheKey = `xy_${z}`;
        if (this.sliceCache.has(cacheKey)) {
            // Move to end of Map (most recently used)
            const value = this.sliceCache.get(cacheKey);
            this.sliceCache.delete(cacheKey);
            this.sliceCache.set(cacheKey, value);

            // Prefetch nearby slices in background
            this.prefetchNearbySlices(z, nz);

            return value;
        }

        if (!this.disableAsyncLoads) {
            // Trigger async load for this slice
            if (!this.prefetchInProgress.has(z)) {
                this.prefetchInProgress.add(z);
                this.getXYSliceAsync(z, nx, ny, nz)
                    .then(() => this.prefetchInProgress.delete(z))
                    .catch(e => {
                        this.prefetchInProgress.delete(z);
                        console.warn(`Failed to cache slice ${z}:`, e);
                    });
            }

            // Prefetch nearby slices in background
            this.prefetchNearbySlices(z, nz);
        }

        // Return upscaled low-res for now
        return this.getUpscaledXYSlice(z, nx, ny);
    }

    /**
     * Prefetch slices around the current z position
     * Limits concurrent reads to maxConcurrentPrefetch
     */
    prefetchNearbySlices(centerZ, nz) {
        const [nx, ny] = this.dimensions;

        // Build ordered list of slices to prefetch (nearest first)
        const toFetch = [];
        for (let offset = 1; offset <= this.prefetchRadius; offset++) {
            const zForward = centerZ + offset;
            if (zForward < nz && !this.sliceCache.has(`xy_${zForward}`) && !this.prefetchInProgress.has(zForward)) {
                toFetch.push(zForward);
            }
            const zBackward = centerZ - offset;
            if (zBackward >= 0 && !this.sliceCache.has(`xy_${zBackward}`) && !this.prefetchInProgress.has(zBackward)) {
                toFetch.push(zBackward);
            }
        }

        // Only launch up to maxConcurrentPrefetch - (already in progress) reads
        const available = this.maxConcurrentPrefetch - this.prefetchInProgress.size;
        const toStart = toFetch.slice(0, Math.max(0, available));

        for (const z of toStart) {
            this.prefetchInProgress.add(z);
            this.getXYSliceAsync(z, nx, ny, nz)
                .then(() => this.prefetchInProgress.delete(z))
                .catch(() => this.prefetchInProgress.delete(z));
        }
    }

    /**
     * Upscale low-res XY slice to full resolution
     */
    getUpscaledXYSlice(z, nx, ny) {
        if (!this.lowResVolume || !this.lowResVolume.dimensions || !this.lowResVolume.data) {
            return {
                data: new Float32Array(nx * ny),
                width: nx,
                height: ny
            };
        }

        const scale = this.lowResScale;
        const [lnx, lny, lnz] = this.lowResVolume.dimensions;
        const lowResData = this.lowResVolume.data;

        // Map z to low-res z
        const lz = Math.min(Math.floor(z / scale), lnz - 1);

        // Upscale using nearest neighbor
        const sliceData = new Float32Array(nx * ny);

        for (let y = 0; y < ny; y++) {
            const ly = Math.min(Math.floor(y / scale), lny - 1);
            for (let x = 0; x < nx; x++) {
                const lx = Math.min(Math.floor(x / scale), lnx - 1);
                const lowIdx = lx + ly * lnx + lz * lnx * lny;
                const highIdx = x + y * nx;
                sliceData[highIdx] = lowResData[lowIdx];
            }
        }

        return {
            data: sliceData,
            width: nx,
            height: ny,
            isLowRes: true
        };
    }

    /**
     * Get XZ slice - returns cached high-res if available, otherwise low-res
     */
    getXZSliceLowRes(y, nx, ny, nz) {
        if (y < 0 || y >= ny) {
            throw new Error(`Slice index ${y} out of bounds [0, ${ny})`);
        }

        // Check if we have cached high-res for this exact y
        if (this.currentXZSlice && this.currentXZIndex === y) {
            return this.currentXZSlice;
        }

        // Trigger async load if not already loading
        if (!this.disableAsyncLoads && (!this.xzLoadInProgress || this.currentXZIndex !== y)) {
            this.loadXZSliceAsync(y);
        }

        // Return low-res for now
        if (!this.lowResVolume || !this.lowResVolume.dimensions || !this.lowResVolume.data) {
            return {
                data: new Float32Array(nx * nz),
                width: nx,
                height: nz
            };
        }

        const scale = this.lowResScale;
        const [lnx, lny, lnz] = this.lowResVolume.dimensions;
        const srcData = this.lowResVolume.data;

        const ly = Math.min(Math.floor(y / scale), lny - 1);

        const sliceData = new Float32Array(nx * nz);

        for (let z = 0; z < nz; z++) {
            const lz = Math.min(Math.floor(z / scale), lnz - 1);
            for (let x = 0; x < nx; x++) {
                const lx = Math.min(Math.floor(x / scale), lnx - 1);
                sliceData[x + z * nx] = srcData[lx + ly * lnx + lz * lnx * lny];
            }
        }

        return {
            data: sliceData,
            width: nx,
            height: nz,
            isLowRes: true
        };
    }

    /**
     * Async load high-res XZ slice using slab-based reads.
     * Reads contiguous blocks of XY slices as single blobs (~50MB each),
     * then extracts row y from each using typed array views (zero-copy).
     * Loads center-out and fires onXZSliceReady after each slab for progressive display.
     */
    async loadXZSliceAsync(y) {
        const [nx, ny, nz] = this.dimensions;
        this.xzLoadInProgress = true;
        this.currentXZIndex = y;
        this.currentXZSlice = null;
        const t0 = performance.now();

        try {
            // Initialize with upscaled low-res data
            const sliceData = new Float32Array(nx * nz);
            if (this.lowResVolume && this.lowResVolume.dimensions && this.lowResVolume.data) {
                const scale = this.lowResScale;
                const [lnx, lny, lnz] = this.lowResVolume.dimensions;
                const srcData = this.lowResVolume.data;
                const ly = Math.min(Math.floor(y / scale), lny - 1);
                for (let z = 0; z < nz; z++) {
                    const lz = Math.min(Math.floor(z / scale), lnz - 1);
                    for (let x = 0; x < nx; x++) {
                        const lx = Math.min(Math.floor(x / scale), lnx - 1);
                        sliceData[x + z * nx] = srcData[lx + ly * lnx + lz * lnx * lny];
                    }
                }
            }
            const tInit = performance.now();
            console.log(`[XZ y=${y}] init from lowRes: ${(tInit - t0).toFixed(1)}ms`);

            // Size slabs to ~50MB max regardless of data type
            const SLAB_BUDGET = 50 * 1024 * 1024;
            const slabSlices = Math.max(1, Math.floor(SLAB_BUDGET / this.sliceSize));
            const totalSlabs = Math.ceil(nz / slabSlices);
            console.log(`[XZ y=${y}] ${totalSlabs} slabs of ${slabSlices} slices (${(slabSlices * this.sliceSize / 1024 / 1024).toFixed(1)}MB each)`);

            // Center-out slab order
            const centerSlab = Math.min(Math.floor(nz / 2 / slabSlices), totalSlabs - 1);
            const slabOrder = [centerSlab];
            for (let offset = 1; offset < totalSlabs; offset++) {
                if (centerSlab + offset < totalSlabs) slabOrder.push(centerSlab + offset);
                if (centerSlab - offset >= 0) slabOrder.push(centerSlab - offset);
            }

            let slabsDone = 0;
            for (const slabIdx of slabOrder) {
                if (this.currentXZIndex !== y) {
                    console.log(`[XZ y=${y}] cancelled after ${slabsDone}/${totalSlabs} slabs (${(performance.now() - t0).toFixed(1)}ms)`);
                    return;
                }

                const zStart = slabIdx * slabSlices;
                const zEnd = Math.min(zStart + slabSlices, nz);

                // One large contiguous read for the entire slab
                const tRead = performance.now();
                const slabBuffer = await this.readBlob(
                    this.file.slice(zStart * this.sliceSize, zEnd * this.sliceSize)
                );
                const tExtract = performance.now();

                // Extract row y from each z-level using typed array views (no copy)
                for (let z = zStart; z < zEnd; z++) {
                    const i = z - zStart;
                    const rowByteOffset = (i * nx * ny + y * nx) * this.bytesPerVoxel;
                    const rowView = this.typedArrayView(slabBuffer, rowByteOffset, nx);
                    sliceData.set(rowView, z * nx);
                }
                slabsDone++;

                const tDone = performance.now();
                if (slabsDone <= 3 || slabsDone === totalSlabs) {
                    console.log(`[XZ y=${y}] slab ${slabsDone}/${totalSlabs} (z=${zStart}-${zEnd}): read=${(tExtract - tRead).toFixed(1)}ms extract=${(tDone - tExtract).toFixed(1)}ms`);
                }

                // Show progressive results after each slab (still partial = isLowRes)
                if (this.currentXZIndex === y) {
                    this.currentXZSlice = {
                        data: sliceData,
                        width: nx,
                        height: nz,
                        isLowRes: slabsDone < totalSlabs
                    };
                    if (this.onXZSliceReady) {
                        this.onXZSliceReady(y);
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Final update with isLowRes: false
            if (this.currentXZIndex === y) {
                this.currentXZSlice = {
                    data: sliceData,
                    width: nx,
                    height: nz,
                    isLowRes: false
                };
                if (this.onXZSliceReady) {
                    this.onXZSliceReady(y);
                }
            }

            console.log(`[XZ y=${y}] complete: ${(performance.now() - t0).toFixed(1)}ms total`);
        } catch (e) {
            console.warn(`Failed to load XZ slice at y=${y}:`, e);
        } finally {
            this.xzLoadInProgress = false;
        }
    }

    /**
     * Get YZ slice - returns cached high-res if available, otherwise low-res
     */
    getYZSliceLowRes(x, nx, ny, nz) {
        if (x < 0 || x >= nx) {
            throw new Error(`Slice index ${x} out of bounds [0, ${nx})`);
        }

        // Check if we have cached high-res for this exact x
        if (this.currentYZSlice && this.currentYZIndex === x) {
            return this.currentYZSlice;
        }

        // Trigger async load if not already loading
        if (!this.disableAsyncLoads && (!this.yzLoadInProgress || this.currentYZIndex !== x)) {
            this.loadYZSliceAsync(x);
        }

        // Return low-res for now
        if (!this.lowResVolume || !this.lowResVolume.dimensions || !this.lowResVolume.data) {
            return {
                data: new Float32Array(ny * nz),
                width: ny,
                height: nz
            };
        }

        const scale = this.lowResScale;
        const [lnx, lny, lnz] = this.lowResVolume.dimensions;
        const srcData = this.lowResVolume.data;

        const lx = Math.min(Math.floor(x / scale), lnx - 1);

        const sliceData = new Float32Array(ny * nz);

        for (let z = 0; z < nz; z++) {
            const lz = Math.min(Math.floor(z / scale), lnz - 1);
            for (let y = 0; y < ny; y++) {
                const ly = Math.min(Math.floor(y / scale), lny - 1);
                sliceData[y + z * ny] = srcData[lx + ly * lnx + lz * lnx * lny];
            }
        }

        return {
            data: sliceData,
            width: ny,
            height: nz,
            isLowRes: true
        };
    }

    /**
     * Async load high-res YZ slice using slab-based reads.
     * Column data is NOT contiguous in file, so we read contiguous blocks of
     * XY slices as single blobs (~50MB each), then extract column x from each
     * z-level using typed array views. Center-out order + progressive display.
     */
    async loadYZSliceAsync(x) {
        const [nx, ny, nz] = this.dimensions;
        this.yzLoadInProgress = true;
        this.currentYZIndex = x;
        this.currentYZSlice = null;
        const t0 = performance.now();

        try {
            // Initialize with upscaled low-res data
            const sliceData = new Float32Array(ny * nz);
            if (this.lowResVolume && this.lowResVolume.dimensions && this.lowResVolume.data) {
                const scale = this.lowResScale;
                const [lnx, lny, lnz] = this.lowResVolume.dimensions;
                const srcData = this.lowResVolume.data;
                const lx = Math.min(Math.floor(x / scale), lnx - 1);
                for (let z = 0; z < nz; z++) {
                    const lz = Math.min(Math.floor(z / scale), lnz - 1);
                    for (let y = 0; y < ny; y++) {
                        const ly = Math.min(Math.floor(y / scale), lny - 1);
                        sliceData[y + z * ny] = srcData[lx + ly * lnx + lz * lnx * lny];
                    }
                }
            }
            const tInit = performance.now();
            console.log(`[YZ x=${x}] init from lowRes: ${(tInit - t0).toFixed(1)}ms`);

            // Size slabs to ~50MB max regardless of data type
            const SLAB_BUDGET = 50 * 1024 * 1024;
            const slabSlices = Math.max(1, Math.floor(SLAB_BUDGET / this.sliceSize));
            const totalSlabs = Math.ceil(nz / slabSlices);
            console.log(`[YZ x=${x}] ${totalSlabs} slabs of ${slabSlices} slices (${(slabSlices * this.sliceSize / 1024 / 1024).toFixed(1)}MB each)`);

            // Center-out slab order
            const centerSlab = Math.min(Math.floor(nz / 2 / slabSlices), totalSlabs - 1);
            const slabOrder = [centerSlab];
            for (let offset = 1; offset < totalSlabs; offset++) {
                if (centerSlab + offset < totalSlabs) slabOrder.push(centerSlab + offset);
                if (centerSlab - offset >= 0) slabOrder.push(centerSlab - offset);
            }

            let slabsDone = 0;
            for (const slabIdx of slabOrder) {
                if (this.currentYZIndex !== x) {
                    console.log(`[YZ x=${x}] cancelled after ${slabsDone}/${totalSlabs} slabs (${(performance.now() - t0).toFixed(1)}ms)`);
                    return;
                }

                const zStart = slabIdx * slabSlices;
                const zEnd = Math.min(zStart + slabSlices, nz);

                // One large contiguous read for the entire slab
                const tRead = performance.now();
                const slabBuffer = await this.readBlob(
                    this.file.slice(zStart * this.sliceSize, zEnd * this.sliceSize)
                );
                const tExtract = performance.now();

                // Extract column x from each z-level in the slab
                // Column data isn't contiguous: element at (x + y*nx) for each y
                for (let z = zStart; z < zEnd; z++) {
                    const i = z - zStart;
                    const sliceByteOffset = i * nx * ny * this.bytesPerVoxel;
                    const sliceView = this.typedArrayView(slabBuffer, sliceByteOffset, nx * ny);
                    for (let y = 0; y < ny; y++) {
                        sliceData[y + z * ny] = sliceView[x + y * nx];
                    }
                }
                slabsDone++;

                const tDone = performance.now();
                if (slabsDone <= 3 || slabsDone === totalSlabs) {
                    console.log(`[YZ x=${x}] slab ${slabsDone}/${totalSlabs} (z=${zStart}-${zEnd}): read=${(tExtract - tRead).toFixed(1)}ms extract=${(tDone - tExtract).toFixed(1)}ms`);
                }

                // Show progressive results after each slab (still partial = isLowRes)
                if (this.currentYZIndex === x) {
                    this.currentYZSlice = {
                        data: sliceData,
                        width: ny,
                        height: nz,
                        isLowRes: slabsDone < totalSlabs
                    };
                    if (this.onYZSliceReady) {
                        this.onYZSliceReady(x);
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Final update with isLowRes: false
            if (this.currentYZIndex === x) {
                this.currentYZSlice = {
                    data: sliceData,
                    width: ny,
                    height: nz,
                    isLowRes: false
                };
                if (this.onYZSliceReady) {
                    this.onYZSliceReady(x);
                }
            }

            console.log(`[YZ x=${x}] complete: ${(performance.now() - t0).toFixed(1)}ms total`);
        } catch (e) {
            console.warn(`Failed to load YZ slice at x=${x}:`, e);
        } finally {
            this.yzLoadInProgress = false;
        }
    }

    /**
     * Add slice to cache with LRU eviction
     */
    addToCache(key, value) {
        // If key already exists, delete it first so re-set moves it to end
        if (this.sliceCache.has(key)) {
            this.sliceCache.delete(key);
        }

        // Evict oldest entries if at capacity
        while (this.sliceCache.size >= this.maxCachedSlices) {
            // Map.keys() iterator yields in insertion order; first key is oldest
            const oldestKey = this.sliceCache.keys().next().value;
            this.sliceCache.delete(oldestKey);
        }

        this.sliceCache.set(key, value);
    }

    /**
     * Read a Blob as ArrayBuffer
     */
    readBlob(blob) {
        const doRead = () => blob.arrayBuffer();
        this._readQueue = this._readQueue.then(doRead, doRead);
        return this._readQueue;
    }

    /**
     * Convert ArrayBuffer to appropriate TypedArray
     */
    bufferToTypedArray(buffer, dataType) {
        switch (dataType.toLowerCase()) {
            case 'uint8': return new Uint8Array(buffer);
            case 'uint16': return new Uint16Array(buffer);
            case 'float':
            case 'float32': return new Float32Array(buffer);
            default: return new Float32Array(buffer);
        }
    }

    /**
     * Create a TypedArray view into a buffer at a byte offset (no copy)
     */
    typedArrayView(buffer, byteOffset, length) {
        switch (this.dataType.toLowerCase()) {
            case 'uint8': return new Uint8Array(buffer, byteOffset, length);
            case 'uint16': return new Uint16Array(buffer, byteOffset, length);
            case 'float':
            case 'float32': return new Float32Array(buffer, byteOffset, length);
            default: return new Float32Array(buffer, byteOffset, length);
        }
    }

    /**
     * Get value at specific 3D coordinate
     * Returns low-res interpolated value (can't read single voxel efficiently)
     */
    getValue(x, y, z) {
        const [nx, ny, nz] = this.dimensions;
        if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) {
            return null;
        }

        if (!this.lowResVolume || !this.lowResVolume.dimensions || !this.lowResVolume.data) {
            return 0;
        }

        const scale = this.lowResScale;
        const [lnx, lny, lnz] = this.lowResVolume.dimensions;

        const lx = Math.min(Math.floor(x / scale), lnx - 1);
        const ly = Math.min(Math.floor(y / scale), lny - 1);
        const lz = Math.min(Math.floor(z / scale), lnz - 1);

        const lowIdx = lx + ly * lnx + lz * lnx * lny;
        return this.lowResVolume.data[lowIdx];
    }

    /**
     * Get volume info
     */
    getInfo() {
        const [nx, ny, nz] = this.dimensions;
        return {
            dimensions: this.dimensions,
            dataType: this.dataType,
            spacing: this.spacing,
            range: [this.min, this.max],
            totalVoxels: nx * ny * nz,
            memorySizeMB: 'streaming',
            isStreaming: true
        };
    }

    /**
     * Check if this is a single-slice volume
     */
    isSingleSlice() {
        return this.dimensions[2] === 1;
    }

    /**
     * Check if this is an RGB volume
     */
    isRGB() {
        return this.metadata.isRGB === true;
    }

    /**
     * Get channel label for RGB volumes
     */
    getChannelLabel(zIndex) {
        if (this.metadata.isRGB && this.dimensions[2] === 3) {
            return ['Red', 'Green', 'Blue'][zIndex] || null;
        }
        return null;
    }

    /**
     * Get full volume data for 3D renderer
     * For streaming mode, returns the low-res volume
     */
    getFullVolumeData() {
        // In streaming mode, 3D renderer uses low-res data
        // Full resolution 3D isn't feasible for multi-GB volumes
        if (this.lowResVolume && this.lowResVolume.dimensions && this.lowResVolume.data) {
            return {
                dimensions: this.lowResVolume.dimensions,
                dataType: this.dataType,
                spacing: this.lowResVolume.spacing || this.spacing,
                data: this.lowResVolume.data,
                min: this.min,
                max: this.max,
                isLowRes: true
            };
        }
        return null;
    }

    /**
     * Check if 3D can be enhanced (streaming mode with scale > 2)
     */
    canEnhance3D() {
        return this.isStreaming && this.lowResScale > 2;
    }

    /**
     * Create enhanced resolution volume for 3D rendering (scale=2 instead of scale=4)
     * @param {function} onProgress - Progress callback (0-100)
     * @returns {Promise<Object>} Enhanced volume data
     */
    async createEnhanced3DVolume(onProgress) {
        const scale = 2;
        const [nx, ny, nz] = this.dimensions;

        const dstNx = Math.ceil(nx / scale);
        const dstNy = Math.ceil(ny / scale);
        const dstNz = Math.ceil(nz / scale);

        console.log(`Enhancing 3D: Creating ${dstNx}×${dstNy}×${dstNz} volume (scale=${scale})`);

        // Allocate enhanced buffer
        const enhancedData = new Float32Array(dstNx * dstNy * dstNz);

        // Process every 'scale'-th z-slice
        for (let dz = 0; dz < dstNz; dz++) {
            const srcZ = dz * scale;

            // Read one slice from file
            const sliceStart = srcZ * this.sliceSize;
            const sliceEnd = Math.min(sliceStart + this.sliceSize, this.file.size);
            const sliceBlob = this.file.slice(sliceStart, sliceEnd);

            let sliceBuffer;
            try {
                sliceBuffer = await this.readBlob(sliceBlob);
            } catch (e) {
                console.error(`Failed to read slice ${dz}:`, e);
                continue;
            }

            const sliceData = this.bufferToTypedArray(sliceBuffer, this.dataType);

            // Downsample this slice
            for (let dy = 0; dy < dstNy; dy++) {
                const srcY = dy * scale;
                for (let dx = 0; dx < dstNx; dx++) {
                    const srcX = dx * scale;

                    // Sample single voxel (nearest neighbor for speed)
                    const srcIdx = srcX + srcY * nx;
                    const value = srcIdx < sliceData.length ? sliceData[srcIdx] : 0;

                    const dstIdx = dx + dy * dstNx + dz * dstNx * dstNy;
                    enhancedData[dstIdx] = value;
                }
            }

            // Progress update
            if (onProgress && dz % 5 === 0) {
                onProgress(Math.round((dz / dstNz) * 100));
                await new Promise(resolve => setTimeout(resolve, 0)); // Yield to UI
            }
        }

        const enhancedVolume = {
            dimensions: [dstNx, dstNy, dstNz],
            dataType: this.dataType,
            spacing: this.spacing.map(s => s * scale),
            data: enhancedData,
            min: this.min,
            max: this.max,
            isEnhanced: true
        };

        console.log(`Enhanced 3D volume created: ${dstNx}×${dstNy}×${dstNz}`);

        return enhancedVolume;
    }

    /**
     * Get loading progress (for API compatibility with ProgressiveVolumeData)
     */
    getLoadProgress() {
        const totalBlocks = this.blockBoundaries.length - 1;
        const blocksLoaded = this.activeBlocks.size;
        return {
            blocksLoaded,
            totalBlocks,
            percent: Math.round((blocksLoaded / totalBlocks) * 100)
        };
    }
}
