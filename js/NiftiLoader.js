class NiftiLoader {
    async loadNifti(file) {
        if (!file) {
            throw new Error('No NIfTI file provided');
        }

        const lower = file.name.toLowerCase();
        const isGz = lower.endsWith('.nii.gz');

        let buffer = await file.arrayBuffer();
        if (isGz) {
            buffer = await this.decompressGzip(buffer);
        }

        const parsed = this.parseNifti(buffer);
        return new VolumeData(parsed.data.buffer, parsed.metadata);
    }

    async decompressGzip(buffer) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Gzip decompression is not supported in this browser');
        }

        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buffer]).stream().pipeThrough(ds);
        const response = new Response(stream);
        return response.arrayBuffer();
    }

    parseNifti(buffer) {
        const view = new DataView(buffer);
        let littleEndian = true;

        let headerSize = view.getInt32(0, true);
        if (headerSize !== 348) {
            headerSize = view.getInt32(0, false);
            if (headerSize !== 348) {
                throw new Error('Invalid NIfTI header');
            }
            littleEndian = false;
        }

        const dim0 = view.getInt16(40, littleEndian);
        const dim1 = view.getInt16(42, littleEndian);
        const dim2 = view.getInt16(44, littleEndian);
        const dim3 = view.getInt16(46, littleEndian);
        const dim4 = view.getInt16(48, littleEndian);

        if (dim0 < 3 || dim1 <= 0 || dim2 <= 0 || dim3 <= 0) {
            throw new Error('Invalid NIfTI dimensions');
        }

        const datatype = view.getInt16(70, littleEndian);
        const voxOffset = view.getFloat32(108, littleEndian);
        const slope = view.getFloat32(112, littleEndian);
        const intercept = view.getFloat32(116, littleEndian);

        const pixdim = [];
        for (let i = 0; i < 8; i++) {
            pixdim.push(view.getFloat32(76 + i * 4, littleEndian));
        }

        const spacing = [
            pixdim[1] > 0 ? pixdim[1] : 1.0,
            pixdim[2] > 0 ? pixdim[2] : 1.0,
            pixdim[3] > 0 ? pixdim[3] : 1.0
        ];

        const bytesPerVoxel = this.bytesPerVoxel(datatype);
        if (!bytesPerVoxel) {
            throw new Error(`Unsupported NIfTI datatype: ${datatype}`);
        }

        const totalVoxels = dim1 * dim2 * dim3;
        const dataOffset = Math.max(0, Math.floor(voxOffset));
        const dataView = new DataView(buffer, dataOffset);

        const s = (slope === 0 || !Number.isFinite(slope)) ? 1 : slope;
        const i = Number.isFinite(intercept) ? intercept : 0;

        const out = new Float32Array(totalVoxels);
        let offset = 0;

        if (datatype === 128) {
            // RGB24: convert to grayscale
            for (let idx = 0; idx < totalVoxels; idx++) {
                const r = dataView.getUint8(offset);
                const g = dataView.getUint8(offset + 1);
                const b = dataView.getUint8(offset + 2);
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                out[idx] = gray * s + i;
                offset += 3;
            }
        } else {
            for (let idx = 0; idx < totalVoxels; idx++) {
                const value = this.readValue(dataView, offset, datatype, littleEndian);
                out[idx] = value * s + i;
                offset += bytesPerVoxel;
            }
        }

        const metadata = {
            dimensions: [dim1, dim2, dim3],
            dataType: 'float32',
            spacing: spacing,
            description: dim4 > 1 ? 'NIfTI (first volume)' : 'NIfTI'
        };

        return { data: out, metadata: metadata };
    }

    bytesPerVoxel(datatype) {
        switch (datatype) {
            case 2: return 1;   // uint8
            case 4: return 2;   // int16
            case 8: return 4;   // int32
            case 16: return 4;  // float32
            case 64: return 8;  // float64
            case 128: return 3; // RGB24
            case 256: return 1; // int8
            case 512: return 2; // uint16
            case 768: return 4; // uint32
            default: return 0;
        }
    }

    readValue(view, offset, datatype, littleEndian) {
        switch (datatype) {
            case 2: return view.getUint8(offset);
            case 4: return view.getInt16(offset, littleEndian);
            case 8: return view.getInt32(offset, littleEndian);
            case 16: return view.getFloat32(offset, littleEndian);
            case 64: return view.getFloat64(offset, littleEndian);
            case 256: return view.getInt8(offset);
            case 512: return view.getUint16(offset, littleEndian);
            case 768: return view.getUint32(offset, littleEndian);
            default: return 0;
        }
    }
}
