/**
 * Progressive Volume Loader
 * Handles progressive loading of volume data with Z-axis tiling
 * For very large files, uses streaming to avoid memory limits
 */
class ProgressiveVolumeLoader {
    constructor() {
        this.NUM_BLOCKS = 5;
        this.DOWNSAMPLE_SCALE = 4;
        // Files larger than 1GB use streaming mode
        this.STREAMING_THRESHOLD = 1024 * 1024 * 1024;
    }

    /**
     * Load volume progressively with callbacks for each phase
     * @param {ArrayBuffer|null} source - Raw volume data, or null for streaming mode
     * @param {Object} metadata - Volume metadata (dimensions, dataType, etc.)
     * @param {Object} callbacks - { onLowResReady, onBlockReady, onAllBlocksReady }
     * @param {File} file - Original file reference for streaming large files
     * @returns {ProgressiveVolumeData|StreamingVolumeData}
     */
    async loadProgressive(source, metadata, callbacks, file = null) {
        const [nx, ny, nz] = metadata.dimensions;
        const bytesPerVoxel = this.getBytesPerVoxel(metadata.dataType);
        const totalSize = nx * ny * nz * bytesPerVoxel;

        // Use streaming mode if:
        // 1. source is null and file is provided (explicitly requested streaming)
        // 2. file is provided and total size exceeds threshold
        const useStreaming = file && (source === null || totalSize > this.STREAMING_THRESHOLD);

        if (useStreaming) {
            console.log(`Progressive loader: Using streaming mode for ${(totalSize / (1024*1024*1024)).toFixed(2)} GB file`);
            return this.loadProgressiveStreaming(file, metadata, callbacks);
        }

        // Standard mode: full data in memory
        const arrayBuffer = source;
        const fullData = this.parseRawData(arrayBuffer, metadata);

        // Calculate block boundaries
        const blockBoundaries = this.calculateBlockBoundaries(nz, this.NUM_BLOCKS);

        // Create progressive volume data container
        const progressiveData = new ProgressiveVolumeData(metadata, fullData, blockBoundaries);

        // Phase 1: Create and emit low-res version (async to allow UI update)
        await this.yieldToUI();

        console.log('Progressive loader: Creating low-res preview...');
        const { lowResData, lowResDims, min, max } = this.downsampleVolume(
            fullData, [nx, ny, nz], this.DOWNSAMPLE_SCALE
        );

        // Create low-res volume object for 3D renderer
        const lowResVolume = {
            dimensions: lowResDims,
            dataType: metadata.dataType,
            spacing: metadata.spacing ? metadata.spacing.map(s => s * this.DOWNSAMPLE_SCALE) : [1, 1, 1],
            data: lowResData,
            min: min,
            max: max
        };

        // Store in progressive data
        progressiveData.setLowResData(lowResVolume, min, max);

        console.log(`Progressive loader: Low-res ready (${lowResDims.join('x')})`);
        if (callbacks.onLowResReady) {
            callbacks.onLowResReady(lowResVolume, progressiveData);
        }

        // Phase 2 & 3: Load blocks in order (center first, then outward)
        const loadOrder = this.getBlockLoadOrder(this.NUM_BLOCKS);

        for (const blockIndex of loadOrder) {
            await this.yieldToUI();

            const zStart = blockBoundaries[blockIndex];
            const zEnd = blockBoundaries[blockIndex + 1];

            console.log(`Progressive loader: Activating block ${blockIndex} (z=${zStart}-${zEnd})`);

            // Mark block as loaded (data is already in fullData, just mark it active)
            progressiveData.activateBlock(blockIndex);

            if (callbacks.onBlockReady) {
                callbacks.onBlockReady(blockIndex, zStart, zEnd);
            }
        }

        // Phase 4: All blocks ready
        console.log('Progressive loader: All blocks loaded');
        progressiveData.markFullyLoaded();

        if (callbacks.onAllBlocksReady) {
            callbacks.onAllBlocksReady();
        }

        return progressiveData;
    }

    /**
     * Load volume in streaming mode - never loads full data into memory
     * Reads slices on-demand from file
     */
    async loadProgressiveStreaming(file, metadata, callbacks) {
        const [nx, ny, nz] = metadata.dimensions;

        // Calculate block boundaries
        const blockBoundaries = this.calculateBlockBoundaries(nz, this.NUM_BLOCKS);

        // Create streaming volume data container (no full data, uses file reference)
        const progressiveData = new StreamingVolumeData(metadata, file, blockBoundaries);

        // Phase 1: Create low-res version by streaming through file
        await this.yieldToUI();

        console.log('Progressive loader (streaming): Creating low-res preview...');
        const { lowResData, lowResDims, min, max } = await this.downsampleVolumeStreaming(
            file, metadata, this.DOWNSAMPLE_SCALE
        );

        // Create low-res volume object for 3D renderer
        const lowResVolume = {
            dimensions: lowResDims,
            dataType: metadata.dataType,
            spacing: metadata.spacing ? metadata.spacing.map(s => s * this.DOWNSAMPLE_SCALE) : [1, 1, 1],
            data: lowResData,
            min: min,
            max: max
        };

        // Store in progressive data
        progressiveData.setLowResData(lowResVolume, min, max);

        console.log(`Progressive loader (streaming): Low-res ready (${lowResDims.join('x')})`);
        if (callbacks.onLowResReady) {
            callbacks.onLowResReady(lowResVolume, progressiveData);
        }

        // Phase 2 & 3: Activate blocks (data read on-demand)
        const loadOrder = this.getBlockLoadOrder(this.NUM_BLOCKS);

        for (const blockIndex of loadOrder) {
            await this.yieldToUI();

            const zStart = blockBoundaries[blockIndex];
            const zEnd = blockBoundaries[blockIndex + 1];

            console.log(`Progressive loader (streaming): Activating block ${blockIndex} (z=${zStart}-${zEnd})`);

            // Mark block as active (actual data read on-demand when slices requested)
            progressiveData.activateBlock(blockIndex);

            if (callbacks.onBlockReady) {
                callbacks.onBlockReady(blockIndex, zStart, zEnd);
            }
        }

        // Phase 4: All blocks ready
        console.log('Progressive loader (streaming): All blocks activated');
        progressiveData.markFullyLoaded();

        if (callbacks.onAllBlocksReady) {
            callbacks.onAllBlocksReady();
        }

        return progressiveData;
    }

    /**
     * Get bytes per voxel for a data type
     */
    getBytesPerVoxel(dataType) {
        switch (dataType.toLowerCase()) {
            case 'uint8': return 1;
            case 'uint16': return 2;
            case 'float':
            case 'float32': return 4;
            default: return 4;
        }
    }

    /**
     * Create downsampled volume by streaming through file
     * Never loads full volume into memory
     */
    async downsampleVolumeStreaming(file, metadata, scale) {
        const [nx, ny, nz] = metadata.dimensions;
        const bytesPerVoxel = this.getBytesPerVoxel(metadata.dataType);
        const sliceSize = nx * ny * bytesPerVoxel;

        const dstNx = Math.ceil(nx / scale);
        const dstNy = Math.ceil(ny / scale);
        const dstNz = Math.ceil(nz / scale);

        // Allocate low-res buffer (much smaller, should succeed)
        const lowResSize = dstNx * dstNy * dstNz;
        const dst = new Float32Array(lowResSize);

        let min = Infinity;
        let max = -Infinity;

        // Process every 'scale'-th z-slice
        for (let dz = 0; dz < dstNz; dz++) {
            const srcZ = dz * scale;

            // Read one slice from file
            const sliceStart = srcZ * sliceSize;
            const sliceEnd = Math.min(sliceStart + sliceSize, file.size);
            const sliceBlob = file.slice(sliceStart, sliceEnd);

            let sliceBuffer;
            try {
                sliceBuffer = await this.readBlob(sliceBlob);
            } catch (e) {
                console.error(`Failed to read slice ${dz} at offset ${sliceStart}:`, e);
                continue; // Skip this slice
            }

            const sliceData = this.bufferToTypedArray(sliceBuffer, metadata.dataType);
            if (!sliceData || sliceData.length === 0) {
                console.warn(`Empty slice data at z=${srcZ}`);
                continue;
            }

            // Downsample this slice
            for (let dy = 0; dy < dstNy; dy++) {
                const srcY = dy * scale;
                for (let dx = 0; dx < dstNx; dx++) {
                    const srcX = dx * scale;

                    // Sample single voxel (nearest neighbor for speed)
                    const srcIdx = srcX + srcY * nx;
                    const value = srcIdx < sliceData.length ? sliceData[srcIdx] : 0;

                    const dstIdx = dx + dy * dstNx + dz * dstNx * dstNy;
                    dst[dstIdx] = value;

                    if (value < min) min = value;
                    if (value > max) max = value;
                }
            }

            // Progress update
            if (dz % 10 === 0) {
                console.log(`Downsampling: ${Math.round((dz / dstNz) * 100)}%`);
                await this.yieldToUI();
            }
        }

        return { lowResData: dst, lowResDims: [dstNx, dstNy, dstNz], min, max };
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
     * Parse raw buffer to typed array based on data type
     */
    parseRawData(buffer, metadata) {
        const dataType = metadata.dataType.toLowerCase();

        switch (dataType) {
            case 'uint8':
                return new Uint8Array(buffer);
            case 'uint16':
                return new Uint16Array(buffer);
            case 'float':
            case 'float32':
                return new Float32Array(buffer);
            default:
                throw new Error(`Unsupported data type: ${dataType}`);
        }
    }

    /**
     * Calculate block boundaries for Z-axis tiling
     * @returns {number[]} Array of z-indices marking block starts (plus end)
     */
    calculateBlockBoundaries(nz, numBlocks) {
        const boundaries = [0];
        const blockSize = Math.ceil(nz / numBlocks);

        for (let i = 1; i < numBlocks; i++) {
            boundaries.push(Math.min(i * blockSize, nz));
        }
        boundaries.push(nz);

        return boundaries;
    }

    /**
     * Get block load order: center first, then outward
     * For 5 blocks [0,1,2,3,4], returns [2, 1, 3, 0, 4]
     */
    getBlockLoadOrder(numBlocks) {
        const center = Math.floor(numBlocks / 2);
        const order = [center];

        for (let offset = 1; offset <= center; offset++) {
            if (center - offset >= 0) order.push(center - offset);
            if (center + offset < numBlocks) order.push(center + offset);
        }

        return order;
    }

    /**
     * Downsample volume using box averaging
     * Also calculates min/max during the pass
     */
    downsampleVolume(srcData, srcDims, scale) {
        const [nx, ny, nz] = srcDims;
        const dstNx = Math.ceil(nx / scale);
        const dstNy = Math.ceil(ny / scale);
        const dstNz = Math.ceil(nz / scale);

        const dst = new srcData.constructor(dstNx * dstNy * dstNz);

        let min = Infinity;
        let max = -Infinity;

        for (let dz = 0; dz < dstNz; dz++) {
            const szStart = dz * scale;
            const szEnd = Math.min(szStart + scale, nz);

            for (let dy = 0; dy < dstNy; dy++) {
                const syStart = dy * scale;
                const syEnd = Math.min(syStart + scale, ny);

                for (let dx = 0; dx < dstNx; dx++) {
                    const sxStart = dx * scale;
                    const sxEnd = Math.min(sxStart + scale, nx);

                    // Box average
                    let sum = 0;
                    let count = 0;

                    for (let sz = szStart; sz < szEnd; sz++) {
                        for (let sy = syStart; sy < syEnd; sy++) {
                            for (let sx = sxStart; sx < sxEnd; sx++) {
                                const srcIdx = sx + sy * nx + sz * nx * ny;
                                const value = srcData[srcIdx];
                                sum += value;
                                count++;

                                // Track min/max from full-res data
                                if (value < min) min = value;
                                if (value > max) max = value;
                            }
                        }
                    }

                    const dstIdx = dx + dy * dstNx + dz * dstNx * dstNy;
                    dst[dstIdx] = sum / count;
                }
            }
        }

        return {
            lowResData: dst,
            lowResDims: [dstNx, dstNy, dstNz],
            min,
            max
        };
    }

    /**
     * Yield to UI thread to keep interface responsive
     */
    yieldToUI() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }
}
