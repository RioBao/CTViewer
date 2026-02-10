/**
 * Progressive Volume Data
 * Manages mixed-resolution volume data with Z-axis block tiling
 * Provides getSlice() that returns high-res or upscaled low-res based on block state
 */
class ProgressiveVolumeData {
    /**
     * @param {Object} metadata - Volume metadata (dimensions, dataType, spacing)
     * @param {TypedArray} fullData - Full resolution volume data
     * @param {number[]} blockBoundaries - Z-indices marking block boundaries
     */
    constructor(metadata, fullData, blockBoundaries) {
        this.dimensions = metadata.dimensions;
        this.dataType = metadata.dataType;
        this.spacing = metadata.spacing || [1, 1, 1];

        // Full resolution data
        this.data = fullData;

        // Low resolution data (set later)
        this.lowResData = null;
        this.lowResDimensions = null;
        this.lowResScale = 4;

        // Block management
        this.blockBoundaries = blockBoundaries;
        this.numBlocks = blockBoundaries.length - 1;
        this.blockActive = new Array(this.numBlocks).fill(false);
        this.fullyLoaded = false;

        // Data range
        this.min = 0;
        this.max = 1;

        // TypedArray constructor for creating slices
        this.TypedArrayConstructor = fullData.constructor;
    }

    /**
     * Set low-res data after downsampling
     */
    setLowResData(lowResVolume, min, max) {
        this.lowResData = lowResVolume.data;
        this.lowResDimensions = lowResVolume.dimensions;
        this.min = min;
        this.max = max;
    }

    /**
     * Mark a block as active (high-res available)
     */
    activateBlock(blockIndex) {
        this.blockActive[blockIndex] = true;
    }

    /**
     * Mark volume as fully loaded
     */
    markFullyLoaded() {
        this.fullyLoaded = true;
    }

    /**
     * Check if all blocks are loaded
     */
    isFullyLoaded() {
        return this.fullyLoaded;
    }

    /**
     * Get which block contains a given Z index
     */
    getBlockForZ(z) {
        for (let i = 0; i < this.numBlocks; i++) {
            if (z >= this.blockBoundaries[i] && z < this.blockBoundaries[i + 1]) {
                return i;
            }
        }
        return this.numBlocks - 1;
    }

    /**
     * Get Z range for a block
     */
    getBlockZRange(blockIndex) {
        return {
            start: this.blockBoundaries[blockIndex],
            end: this.blockBoundaries[blockIndex + 1]
        };
    }

    /**
     * Get a 2D slice from the volume
     * Returns high-res if block is active, otherwise upscaled low-res
     * @param {string} axis - 'xy', 'xz', or 'yz'
     * @param {number} index - Slice index
     * @returns {{ data: TypedArray, width: number, height: number }}
     */
    getSlice(axis, index) {
        switch (axis) {
            case 'xy':
                return this.getXYSlice(index);
            case 'xz':
                return this.getXZSlice(index);
            case 'yz':
                return this.getYZSlice(index);
            default:
                throw new Error(`Unknown axis: ${axis}`);
        }
    }

    /**
     * Get XY slice (constant Z)
     * Entire slice is in one block
     */
    getXYSlice(z) {
        const [nx, ny, nz] = this.dimensions;
        const blockIndex = this.getBlockForZ(z);

        if (this.blockActive[blockIndex]) {
            // Return high-res slice
            const offset = z * nx * ny;
            const sliceData = this.data.slice(offset, offset + nx * ny);
            return { data: sliceData, width: nx, height: ny };
        } else {
            // Return upscaled low-res slice
            return this.getUpscaledXYSlice(z);
        }
    }

    /**
     * Get upscaled low-res XY slice
     */
    getUpscaledXYSlice(z) {
        const [nx, ny, nz] = this.dimensions;
        const [lnx, lny, lnz] = this.lowResDimensions;
        const scale = this.lowResScale;

        const sliceData = new this.TypedArrayConstructor(nx * ny);

        // Map to low-res z
        const lz = Math.min(Math.floor(z / scale), lnz - 1);

        for (let y = 0; y < ny; y++) {
            const ly = Math.min(Math.floor(y / scale), lny - 1);

            for (let x = 0; x < nx; x++) {
                const lx = Math.min(Math.floor(x / scale), lnx - 1);

                const lowResIdx = lx + ly * lnx + lz * lnx * lny;
                const highResIdx = x + y * nx;

                sliceData[highResIdx] = this.lowResData[lowResIdx];
            }
        }

        return { data: sliceData, width: nx, height: ny };
    }

    /**
     * Get XZ slice (constant Y)
     * Spans all Z blocks - composite from high-res and low-res
     */
    getXZSlice(y) {
        const [nx, ny, nz] = this.dimensions;
        const [lnx, lny, lnz] = this.lowResDimensions;
        const scale = this.lowResScale;

        const sliceData = new this.TypedArrayConstructor(nx * nz);

        // Map y to low-res
        const ly = Math.min(Math.floor(y / scale), lny - 1);

        for (let z = 0; z < nz; z++) {
            const blockIndex = this.getBlockForZ(z);
            const useHighRes = this.blockActive[blockIndex];

            // Map z to low-res
            const lz = Math.min(Math.floor(z / scale), lnz - 1);

            for (let x = 0; x < nx; x++) {
                let value;

                if (useHighRes) {
                    const idx3d = x + y * nx + z * nx * ny;
                    value = this.data[idx3d];
                } else {
                    const lx = Math.min(Math.floor(x / scale), lnx - 1);
                    const lowResIdx = lx + ly * lnx + lz * lnx * lny;
                    value = this.lowResData[lowResIdx];
                }

                const idx2d = x + z * nx;
                sliceData[idx2d] = value;
            }
        }

        return { data: sliceData, width: nx, height: nz };
    }

    /**
     * Get YZ slice (constant X)
     * Spans all Z blocks - composite from high-res and low-res
     */
    getYZSlice(x) {
        const [nx, ny, nz] = this.dimensions;
        const [lnx, lny, lnz] = this.lowResDimensions;
        const scale = this.lowResScale;

        const sliceData = new this.TypedArrayConstructor(ny * nz);

        // Map x to low-res
        const lx = Math.min(Math.floor(x / scale), lnx - 1);

        for (let z = 0; z < nz; z++) {
            const blockIndex = this.getBlockForZ(z);
            const useHighRes = this.blockActive[blockIndex];

            // Map z to low-res
            const lz = Math.min(Math.floor(z / scale), lnz - 1);

            for (let y = 0; y < ny; y++) {
                let value;

                if (useHighRes) {
                    const idx3d = x + y * nx + z * nx * ny;
                    value = this.data[idx3d];
                } else {
                    const ly = Math.min(Math.floor(y / scale), lny - 1);
                    const lowResIdx = lx + ly * lnx + lz * lnx * lny;
                    value = this.lowResData[lowResIdx];
                }

                const idx2d = y + z * ny;
                sliceData[idx2d] = value;
            }
        }

        return { data: sliceData, width: ny, height: nz };
    }

    /**
     * Create a full VolumeData object for 3D rendering
     * Only call after fully loaded
     */
    getFullVolumeData() {
        if (!this.fullyLoaded) {
            console.warn('getFullVolumeData called before fully loaded');
        }

        // Create a VolumeData-compatible object
        const volumeData = {
            dimensions: this.dimensions,
            data: this.data,
            dataType: this.dataType,
            spacing: this.spacing,
            min: this.min,
            max: this.max,
            getSlice: (axis, index) => this.getSlice(axis, index)
        };

        return volumeData;
    }

    /**
     * Get loading progress
     */
    getLoadProgress() {
        const blocksLoaded = this.blockActive.filter(b => b).length;
        return {
            blocksLoaded,
            totalBlocks: this.numBlocks,
            percent: Math.round((blocksLoaded / this.numBlocks) * 100)
        };
    }

    /**
     * Get voxel value at a specific 3D coordinate
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {number} Voxel value
     */
    getValue(x, y, z) {
        const [nx, ny, nz] = this.dimensions;

        // Bounds check
        if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) {
            return 0;
        }

        const blockIndex = this.getBlockForZ(z);

        if (this.blockActive[blockIndex]) {
            // High-res value
            const idx = Math.floor(x) + Math.floor(y) * nx + Math.floor(z) * nx * ny;
            return this.data[idx];
        } else {
            // Low-res value (nearest neighbor)
            const [lnx, lny, lnz] = this.lowResDimensions;
            const scale = this.lowResScale;

            const lx = Math.min(Math.floor(x / scale), lnx - 1);
            const ly = Math.min(Math.floor(y / scale), lny - 1);
            const lz = Math.min(Math.floor(z / scale), lnz - 1);

            const lowResIdx = lx + ly * lnx + lz * lnx * lny;
            return this.lowResData[lowResIdx];
        }
    }

    /**
     * Get volume info (for UI display)
     */
    getInfo() {
        return {
            dimensions: this.dimensions,
            dataType: this.dataType,
            spacing: this.spacing,
            min: this.min,
            max: this.max,
            fullyLoaded: this.fullyLoaded
        };
    }

    /**
     * Check if 3D enhancement is available (scale=2 downsample)
     */
    canEnhance3D() {
        const [nx, ny, nz] = this.dimensions;
        return nx > 1 && ny > 1 && nz > 1;
    }

    /**
     * Create enhanced resolution volume for 3D rendering (scale=2)
     * @param {function} onProgress - Progress callback (0-100)
     * @returns {Promise<Object>} Enhanced volume data
     */
    async createEnhanced3DVolume(onProgress) {
        const scale = 2;
        const [nx, ny, nz] = this.dimensions;
        const dstNx = Math.ceil(nx / scale);
        const dstNy = Math.ceil(ny / scale);
        const dstNz = Math.ceil(nz / scale);

        const enhancedData = new this.TypedArrayConstructor(dstNx * dstNy * dstNz);
        const sliceSize = nx * ny;

        for (let dz = 0; dz < dstNz; dz++) {
            const srcZ = dz * scale;
            const srcZOffset = srcZ * sliceSize;
            const dstZOffset = dz * dstNx * dstNy;

            for (let dy = 0; dy < dstNy; dy++) {
                const srcY = dy * scale;
                const srcYOffset = srcZOffset + srcY * nx;
                const dstYOffset = dstZOffset + dy * dstNx;

                for (let dx = 0; dx < dstNx; dx++) {
                    const srcX = dx * scale;
                    const srcIdx = srcYOffset + srcX;
                    const dstIdx = dstYOffset + dx;
                    enhancedData[dstIdx] = this.data[srcIdx];
                }
            }

            if (onProgress && dz % 5 === 0) {
                onProgress(Math.round((dz / dstNz) * 100));
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return {
            dimensions: [dstNx, dstNy, dstNz],
            dataType: this.dataType,
            spacing: this.spacing.map(s => s * scale),
            data: enhancedData,
            min: this.min,
            max: this.max,
            isEnhanced: true
        };
    }
}
