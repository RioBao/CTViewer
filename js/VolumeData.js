class VolumeData {
    constructor(arrayBuffer, metadata) {
        this.dimensions = metadata.dimensions; // [x, y, z]
        this.dataType = metadata.dataType;
        this.spacing = metadata.spacing || [1.0, 1.0, 1.0];
        this.metadata = metadata;

        // Parse raw data based on data type
        this.data = this.parseRawData(arrayBuffer, metadata);

        // Calculate min/max for normalization
        this.calculateMinMax();
    }

    parseRawData(buffer, metadata) {
        const [nx, ny, nz] = metadata.dimensions;
        const expectedSize = nx * ny * nz;

        switch(metadata.dataType.toLowerCase()) {
            case 'uint8':
                if (buffer.byteLength < expectedSize) {
                    throw new Error(`Buffer size mismatch: expected ${expectedSize} bytes, got ${buffer.byteLength}`);
                }
                return new Uint8Array(buffer);

            case 'uint16':
                if (buffer.byteLength < expectedSize * 2) {
                    throw new Error(`Buffer size mismatch: expected ${expectedSize * 2} bytes, got ${buffer.byteLength}`);
                }
                return new Uint16Array(buffer);

            case 'float':
            case 'float32':
                if (buffer.byteLength < expectedSize * 4) {
                    throw new Error(`Buffer size mismatch: expected ${expectedSize * 4} bytes, got ${buffer.byteLength}`);
                }
                return new Float32Array(buffer);

            default:
                throw new Error(`Unsupported data type: ${metadata.dataType}`);
        }
    }

    calculateMinMax() {
        let min = Infinity;
        let max = -Infinity;

        for (let i = 0; i < this.data.length; i++) {
            const value = this.data[i];
            if (value < min) min = value;
            if (value > max) max = value;
        }

        this.min = min;
        this.max = max;
    }

    /**
     * Extract a 2D slice from the 3D volume
     * @param {string} axis - 'xy', 'xz', or 'yz'
     * @param {number} index - Slice index along the perpendicular axis
     * @returns {object} { data: TypedArray, width: number, height: number }
     */
    getSlice(axis, index) {
        const [nx, ny, nz] = this.dimensions;

        switch(axis.toLowerCase()) {
            case 'xy': // Axial slice (constant z)
                return this.getXYSlice(index, nx, ny, nz);

            case 'xz': // Coronal slice (constant y)
                return this.getXZSlice(index, nx, ny, nz);

            case 'yz': // Sagittal slice (constant x)
                return this.getYZSlice(index, nx, ny, nz);

            default:
                throw new Error(`Invalid axis: ${axis}`);
        }
    }

    getXYSlice(z, nx, ny, nz) {
        // Bounds checking
        if (z < 0 || z >= nz) {
            throw new Error(`Slice index ${z} out of bounds [0, ${nz})`);
        }

        // XY slice at z is contiguous in memory
        const offset = z * nx * ny;
        const sliceData = this.data.slice(offset, offset + nx * ny);

        return {
            data: sliceData,
            width: nx,
            height: ny
        };
    }

    getXZSlice(y, nx, ny, nz) {
        // Bounds checking
        if (y < 0 || y >= ny) {
            throw new Error(`Slice index ${y} out of bounds [0, ${ny})`);
        }

        // XZ slice requires Y-stride extraction
        const sliceData = new this.data.constructor(nx * nz);

        for (let z = 0; z < nz; z++) {
            for (let x = 0; x < nx; x++) {
                const idx3d = x + y * nx + z * nx * ny;
                const idx2d = x + z * nx;
                sliceData[idx2d] = this.data[idx3d];
            }
        }

        return {
            data: sliceData,
            width: nx,
            height: nz
        };
    }

    getYZSlice(x, nx, ny, nz) {
        // Bounds checking
        if (x < 0 || x >= nx) {
            throw new Error(`Slice index ${x} out of bounds [0, ${nx})`);
        }

        // YZ slice requires XY-stride extraction
        const sliceData = new this.data.constructor(ny * nz);

        for (let z = 0; z < nz; z++) {
            for (let y = 0; y < ny; y++) {
                const idx3d = x + y * nx + z * nx * ny;
                const idx2d = y + z * ny;
                sliceData[idx2d] = this.data[idx3d];
            }
        }

        return {
            data: sliceData,
            width: ny,
            height: nz
        };
    }

    /**
     * Get the value at a specific 3D coordinate
     */
    getValue(x, y, z) {
        const [nx, ny, nz] = this.dimensions;
        if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) {
            return null;
        }
        const index = x + y * nx + z * nx * ny;
        return this.data[index];
    }

    /**
     * Get information about the volume
     */
    getInfo() {
        return {
            dimensions: this.dimensions,
            dataType: this.dataType,
            spacing: this.spacing,
            range: [this.min, this.max],
            totalVoxels: this.data.length,
            memorySizeMB: (this.data.byteLength / (1024 * 1024)).toFixed(2)
        };
    }

    /**
     * Get channel label for RGB volumes
     * @param {number} zIndex - Slice index along z-axis
     * @returns {string|null} Channel name ('Red', 'Green', 'Blue') or null if not RGB
     */
    getChannelLabel(zIndex) {
        if (this.metadata.isRGB && this.dimensions[2] === 3) {
            return ['Red', 'Green', 'Blue'][zIndex] || null;
        }
        return null;
    }

    /**
     * Check if this is a single-slice volume (2D image)
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
}
