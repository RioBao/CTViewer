/**
 * Streaming Volume Data
 * For very large volumes (>1GB), reads slices on-demand from file
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
        // Cache more slices for smoother scrolling and YZ loading
        // ~4MB per slice for 1004x1004 float, 100 slices = ~400MB max cache
        this.sliceCache = new Map();
        this.maxCachedSlices = 100;
        this.cacheOrder = [];

        // Prefetch settings
        this.prefetchRadius = 10; // Prefetch 10 slices ahead/behind
        this.prefetchInProgress = new Set();

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
            // Move to end of cache order (most recently used)
            const idx = this.cacheOrder.indexOf(cacheKey);
            if (idx > -1) {
                this.cacheOrder.splice(idx, 1);
                this.cacheOrder.push(cacheKey);
            }
            return this.sliceCache.get(cacheKey);
        }

        // Read slice from file
        const sliceStart = z * this.sliceSize;
        const sliceEnd = sliceStart + this.sliceSize;
        const sliceBlob = this.file.slice(sliceStart, sliceEnd);
        const sliceBuffer = await this.readBlob(sliceBlob);
        const sliceData = this.bufferToTypedArray(sliceBuffer, this.dataType);

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
            const idx = this.cacheOrder.indexOf(cacheKey);
            if (idx > -1) {
                this.cacheOrder.splice(idx, 1);
                this.cacheOrder.push(cacheKey);
            }

            // Prefetch nearby slices in background
            this.prefetchNearbySlices(z, nz);

            return this.sliceCache.get(cacheKey);
        }

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

        // Return upscaled low-res for now
        return this.getUpscaledXYSlice(z, nx, ny);
    }

    /**
     * Prefetch slices around the current z position
     */
    prefetchNearbySlices(centerZ, nz) {
        const [nx, ny] = this.dimensions;

        for (let offset = 1; offset <= this.prefetchRadius; offset++) {
            // Prefetch forward
            const zForward = centerZ + offset;
            if (zForward < nz) {
                const keyForward = `xy_${zForward}`;
                if (!this.sliceCache.has(keyForward) && !this.prefetchInProgress.has(zForward)) {
                    this.prefetchInProgress.add(zForward);
                    this.getXYSliceAsync(zForward, nx, ny, nz)
                        .then(() => this.prefetchInProgress.delete(zForward))
                        .catch(() => this.prefetchInProgress.delete(zForward));
                }
            }

            // Prefetch backward
            const zBackward = centerZ - offset;
            if (zBackward >= 0) {
                const keyBackward = `xy_${zBackward}`;
                if (!this.sliceCache.has(keyBackward) && !this.prefetchInProgress.has(zBackward)) {
                    this.prefetchInProgress.add(zBackward);
                    this.getXYSliceAsync(zBackward, nx, ny, nz)
                        .then(() => this.prefetchInProgress.delete(zBackward))
                        .catch(() => this.prefetchInProgress.delete(zBackward));
                }
            }
        }
    }

    /**
     * Upscale low-res XY slice to full resolution
     */
    getUpscaledXYSlice(z, nx, ny) {
        if (!this.lowResVolume || !this.lowResVolume.dimensions || !this.lowResVolume.data) {
            // Return empty slice if no low-res yet
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
        if (!this.xzLoadInProgress || this.currentXZIndex !== y) {
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
        const lowResData = this.lowResVolume.data;

        // Map y to low-res y
        const ly = Math.min(Math.floor(y / scale), lny - 1);

        // Upscale XZ slice
        const sliceData = new Float32Array(nx * nz);

        for (let z = 0; z < nz; z++) {
            const lz = Math.min(Math.floor(z / scale), lnz - 1);
            for (let x = 0; x < nx; x++) {
                const lx = Math.min(Math.floor(x / scale), lnx - 1);
                const lowIdx = lx + ly * lnx + lz * lnx * lny;
                const highIdx = x + z * nx;
                sliceData[highIdx] = lowResData[lowIdx];
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
     * Async load high-res XZ slice by reading row from each Z slice
     */
    async loadXZSliceAsync(y) {
        const [nx, ny, nz] = this.dimensions;
        this.xzLoadInProgress = true;
        this.currentXZIndex = y;
        // Clear cached slice to prevent returning stale data during load
        this.currentXZSlice = null;

        try {
            const sliceData = new Float32Array(nx * nz);

            // Read row y from each Z slice
            for (let z = 0; z < nz; z++) {
                // Calculate file offset for row y in slice z
                const rowStart = (z * nx * ny + y * nx) * this.bytesPerVoxel;
                const rowEnd = rowStart + nx * this.bytesPerVoxel;

                const rowBlob = this.file.slice(rowStart, rowEnd);
                const rowBuffer = await this.readBlob(rowBlob);
                const rowData = this.bufferToTypedArray(rowBuffer, this.dataType);

                // Copy row into slice
                for (let x = 0; x < nx && x < rowData.length; x++) {
                    sliceData[x + z * nx] = rowData[x];
                }

                // Yield occasionally to keep UI responsive
                if (z % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Only update if this is still the requested slice
            if (this.currentXZIndex === y) {
                this.currentXZSlice = {
                    data: sliceData,
                    width: nx,
                    height: nz
                };

                // Notify listener
                if (this.onXZSliceReady) {
                    this.onXZSliceReady(y);
                }
            }
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
        if (!this.yzLoadInProgress || this.currentYZIndex !== x) {
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
        const lowResData = this.lowResVolume.data;

        // Map x to low-res x
        const lx = Math.min(Math.floor(x / scale), lnx - 1);

        // Upscale YZ slice
        const sliceData = new Float32Array(ny * nz);

        for (let z = 0; z < nz; z++) {
            const lz = Math.min(Math.floor(z / scale), lnz - 1);
            for (let y = 0; y < ny; y++) {
                const ly = Math.min(Math.floor(y / scale), lny - 1);
                const lowIdx = lx + ly * lnx + lz * lnx * lny;
                const highIdx = y + z * ny;
                sliceData[highIdx] = lowResData[lowIdx];
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
     * Async load high-res YZ slice by reading column from each Z slice
     * Caches XY slices as they're read for faster subsequent access
     */
    async loadYZSliceAsync(x) {
        const [nx, ny, nz] = this.dimensions;
        this.yzLoadInProgress = true;
        this.currentYZIndex = x;
        // Clear cached slice to prevent returning stale data during load
        this.currentYZSlice = null;

        try {
            const sliceData = new Float32Array(ny * nz);

            // Read column x from each Z slice
            // Read in batches to improve performance
            const BATCH_SIZE = 20;

            for (let zStart = 0; zStart < nz; zStart += BATCH_SIZE) {
                const zEnd = Math.min(zStart + BATCH_SIZE, nz);

                // Process batch of Z slices in parallel
                const batchPromises = [];
                for (let z = zStart; z < zEnd; z++) {
                    batchPromises.push(this.loadAndCacheXYSlice(z, nx, ny));
                }

                const batchResults = await Promise.all(batchPromises);

                // Extract column x from each slice in batch
                for (let i = 0; i < batchResults.length; i++) {
                    const z = zStart + i;
                    const xySliceData = batchResults[i];

                    for (let y = 0; y < ny && (x + y * nx) < xySliceData.length; y++) {
                        sliceData[y + z * ny] = xySliceData[x + y * nx];
                    }
                }

                // Yield to keep UI responsive between batches
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Only update if this is still the requested slice
            if (this.currentYZIndex === x) {
                this.currentYZSlice = {
                    data: sliceData,
                    width: ny,
                    height: nz
                };

                // Notify listener
                if (this.onYZSliceReady) {
                    this.onYZSliceReady(x);
                }
            }
        } catch (e) {
            console.warn(`Failed to load YZ slice at x=${x}:`, e);
        } finally {
            this.yzLoadInProgress = false;
        }
    }

    /**
     * Load and cache an XY slice, returning the data
     */
    async loadAndCacheXYSlice(z, nx, ny) {
        const cacheKey = `xy_${z}`;

        // Check cache first
        if (this.sliceCache.has(cacheKey)) {
            return this.sliceCache.get(cacheKey).data;
        }

        // Read from file
        const sliceStart = z * nx * ny * this.bytesPerVoxel;
        const sliceEnd = sliceStart + nx * ny * this.bytesPerVoxel;

        const sliceBlob = this.file.slice(sliceStart, sliceEnd);
        const sliceBuffer = await this.readBlob(sliceBlob);
        const xySliceData = this.bufferToTypedArray(sliceBuffer, this.dataType);

        // Cache the slice for future use
        const result = {
            data: xySliceData,
            width: nx,
            height: ny
        };
        this.addToCache(cacheKey, result);

        return xySliceData;
    }

    /**
     * Add slice to cache with LRU eviction
     */
    addToCache(key, value) {
        // Evict oldest if at capacity
        while (this.cacheOrder.length >= this.maxCachedSlices) {
            const oldestKey = this.cacheOrder.shift();
            this.sliceCache.delete(oldestKey);
        }

        this.sliceCache.set(key, value);
        this.cacheOrder.push(key);
    }

    /**
     * Read a Blob as ArrayBuffer
     */
    readBlob(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read blob'));
            reader.readAsArrayBuffer(blob);
        });
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
