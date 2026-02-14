/**
 * DICOM streaming volume data.
 * Uses per-slice manifests (file + pixel data offsets) instead of contiguous raw bytes.
 */
class DicomStreamingVolumeData extends StreamingVolumeData {
    constructor(metadata, sliceManifests, blockBoundaries) {
        const fallbackFile = (sliceManifests && sliceManifests.length > 0) ? sliceManifests[0].file : null;
        super(metadata, fallbackFile, blockBoundaries);

        this.sliceManifests = Array.isArray(sliceManifests) ? sliceManifests : [];
        this.dataType = 'float32';
        this.bytesPerVoxel = 4;

        const [nx, ny] = this.dimensions;
        this.sliceSize = nx * ny * this.bytesPerVoxel;
    }

    static decodeSliceBuffer(buffer, manifest) {
        const rows = manifest.rows;
        const cols = manifest.cols;
        const expected = rows * cols;

        const bitsAllocated = manifest.bitsAllocated;
        const signed = manifest.pixelRepresentation === 1;
        const littleEndian = manifest.littleEndian !== false;
        const slope = (manifest.rescaleSlope === undefined || manifest.rescaleSlope === null || manifest.rescaleSlope === 0)
            ? 1
            : manifest.rescaleSlope;
        const intercept = manifest.rescaleIntercept || 0;
        const flipX = manifest.flipX === true;
        const flipY = manifest.flipY === true;

        let src = null;
        if (bitsAllocated === 8) {
            src = signed ? new Int8Array(buffer) : new Uint8Array(buffer);
        } else if (bitsAllocated === 16) {
            if (littleEndian) {
                src = signed ? new Int16Array(buffer) : new Uint16Array(buffer);
            } else {
                const view = new DataView(buffer);
                const tmp = signed ? new Int16Array(expected) : new Uint16Array(expected);
                const limit = Math.min(expected, Math.floor(buffer.byteLength / 2));
                for (let i = 0; i < limit; i++) {
                    tmp[i] = signed ? view.getInt16(i * 2, false) : view.getUint16(i * 2, false);
                }
                src = tmp;
            }
        } else {
            throw new Error(`Unsupported DICOM BitsAllocated: ${bitsAllocated}`);
        }

        const out = new Float32Array(expected);
        const len = Math.min(expected, src.length);
        if (!flipX && !flipY) {
            for (let i = 0; i < len; i++) {
                out[i] = src[i] * slope + intercept;
            }
            return out;
        }

        const maxX = cols - 1;
        const maxY = rows - 1;
        for (let y = 0; y < rows; y++) {
            const srcY = flipY ? (maxY - y) : y;
            const dstRow = y * cols;
            const srcRow = srcY * cols;
            for (let x = 0; x < cols; x++) {
                const srcX = flipX ? (maxX - x) : x;
                const srcIdx = srcRow + srcX;
                if (srcIdx < len) {
                    out[dstRow + x] = src[srcIdx] * slope + intercept;
                }
            }
        }

        return out;
    }

    async readDicomSlice(z) {
        const manifest = this.sliceManifests[z];
        const [nx, ny, nz] = this.dimensions;

        if (!manifest) {
            return new Float32Array(nx * ny);
        }

        if (z < 0 || z >= nz) {
            throw new Error(`Slice index ${z} out of bounds [0, ${nz})`);
        }

        const expectedBytes = manifest.frameLengthBytes || (manifest.rows * manifest.cols * (manifest.bitsAllocated / 8));
        const start = manifest.pixelDataOffset + (manifest.frameOffsetBytes || 0);
        const end = start + expectedBytes;
        const blob = manifest.file.slice(start, end);
        const buffer = await this.readBlob(blob);

        return DicomStreamingVolumeData.decodeSliceBuffer(buffer, manifest);
    }

    async getXYSliceAsync(z, nx, ny, nz) {
        if (z < 0 || z >= nz) {
            throw new Error(`Slice index ${z} out of bounds [0, ${nz})`);
        }

        const cacheKey = `xy_${z}`;
        if (this.sliceCache.has(cacheKey)) {
            const value = this.sliceCache.get(cacheKey);
            this.sliceCache.delete(cacheKey);
            this.sliceCache.set(cacheKey, value);
            return value;
        }

        const sliceData = await this.readDicomSlice(z);
        const result = {
            data: sliceData,
            width: nx,
            height: ny
        };

        this.addToCache(cacheKey, result);

        if (this.onSliceReady) {
            this.onSliceReady(z);
        }

        return result;
    }

    async loadXZSliceAsync(y) {
        const [nx, ny, nz] = this.dimensions;
        this.xzLoadInProgress = true;
        this.currentXZIndex = y;
        this.currentXZSlice = null;

        try {
            const sliceData = this.getXZSliceLowRes(y, nx, ny, nz).data;
            const order = this.getCenterOutOrder(nz);
            let loaded = 0;

            for (const z of order) {
                if (this.currentXZIndex !== y) return;

                let xy = null;
                const cacheKey = `xy_${z}`;
                if (this.sliceCache.has(cacheKey)) {
                    xy = this.sliceCache.get(cacheKey);
                } else {
                    xy = await this.getXYSliceAsync(z, nx, ny, nz);
                }

                const rowOffset = y * nx;
                for (let x = 0; x < nx; x++) {
                    sliceData[x + z * nx] = xy.data[rowOffset + x];
                }

                loaded++;
                if (this.currentXZIndex === y) {
                    this.currentXZSlice = {
                        data: sliceData,
                        width: nx,
                        height: nz,
                        isLowRes: loaded < nz
                    };
                    if (this.onXZSliceReady) {
                        this.onXZSliceReady(y);
                    }
                }

                if (loaded % 8 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
        } catch (e) {
            console.warn(`Failed to load XZ slice at y=${y}:`, e);
        } finally {
            this.xzLoadInProgress = false;
        }
    }

    async loadYZSliceAsync(x) {
        const [nx, ny, nz] = this.dimensions;
        this.yzLoadInProgress = true;
        this.currentYZIndex = x;
        this.currentYZSlice = null;

        try {
            const sliceData = this.getYZSliceLowRes(x, nx, ny, nz).data;
            const order = this.getCenterOutOrder(nz);
            let loaded = 0;

            for (const z of order) {
                if (this.currentYZIndex !== x) return;

                let xy = null;
                const cacheKey = `xy_${z}`;
                if (this.sliceCache.has(cacheKey)) {
                    xy = this.sliceCache.get(cacheKey);
                } else {
                    xy = await this.getXYSliceAsync(z, nx, ny, nz);
                }

                for (let y = 0; y < ny; y++) {
                    sliceData[y + z * ny] = xy.data[x + y * nx];
                }

                loaded++;
                if (this.currentYZIndex === x) {
                    this.currentYZSlice = {
                        data: sliceData,
                        width: ny,
                        height: nz,
                        isLowRes: loaded < nz
                    };
                    if (this.onYZSliceReady) {
                        this.onYZSliceReady(x);
                    }
                }

                if (loaded % 8 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
        } catch (e) {
            console.warn(`Failed to load YZ slice at x=${x}:`, e);
        } finally {
            this.yzLoadInProgress = false;
        }
    }

    getCenterOutOrder(length) {
        const center = Math.floor(length / 2);
        const order = [center];

        for (let offset = 1; offset <= center; offset++) {
            if (center + offset < length) order.push(center + offset);
            if (center - offset >= 0) order.push(center - offset);
        }
        return order;
    }

    async createEnhanced3DVolume(onProgress) {
        const scale = 2;
        const [nx, ny, nz] = this.dimensions;
        const dstNx = Math.ceil(nx / scale);
        const dstNy = Math.ceil(ny / scale);
        const dstNz = Math.ceil(nz / scale);
        const enhancedData = new Float32Array(dstNx * dstNy * dstNz);

        for (let dz = 0; dz < dstNz; dz++) {
            const srcZ = dz * scale;
            const sliceData = await this.readDicomSlice(srcZ);

            for (let dy = 0; dy < dstNy; dy++) {
                const srcY = dy * scale;
                for (let dx = 0; dx < dstNx; dx++) {
                    const srcX = dx * scale;
                    const srcIdx = srcX + srcY * nx;
                    const value = srcIdx < sliceData.length ? sliceData[srcIdx] : 0;
                    enhancedData[dx + dy * dstNx + dz * dstNx * dstNy] = value;
                }
            }

            if (onProgress && dz % 5 === 0) {
                onProgress(Math.round((dz / dstNz) * 100));
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        return {
            dimensions: [dstNx, dstNy, dstNz],
            dataType: this.dataType,
            spacing: this.spacing.map((s) => s * scale),
            data: enhancedData,
            min: this.min,
            max: this.max,
            isEnhanced: true
        };
    }
}

window.DicomStreamingVolumeData = DicomStreamingVolumeData;
