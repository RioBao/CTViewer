class NiftiLoader {
    async loadNifti(file, progressCallback = null) {
        if (!file) {
            throw new Error('No NIfTI file provided');
        }

        const lower = file.name.toLowerCase();
        const isGz = lower.endsWith('.nii.gz');

        if (progressCallback) {
            progressCallback({ stage: 'metadata', progress: 0 });
            progressCallback({ stage: 'loading', progress: 0 });
        }

        let buffer = await file.arrayBuffer();
        if (progressCallback) {
            progressCallback({ stage: 'loading', progress: isGz ? 40 : 100 });
        }
        if (isGz) {
            buffer = await this.decompressGzip(buffer);
            if (progressCallback) {
                progressCallback({ stage: 'loading', progress: 100 });
            }
        }

        const parsed = await this.parseNifti(buffer, (percent) => {
            if (progressCallback) {
                progressCallback({ stage: 'processing', progress: percent });
            }
        });
        if (progressCallback) {
            progressCallback({ stage: 'complete', progress: 100 });
        }
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

    async parseNifti(buffer, parseProgressCallback = null) {
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
        const originalDimensions = [dim1, dim2, dim3];
        let activeDimensions = originalDimensions.slice();
        let activeSpacing = spacing.slice();

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
        await this.decodeNiftiDataToFloat32(
            dataView,
            datatype,
            littleEndian,
            bytesPerVoxel,
            s,
            i,
            out,
            (percent) => {
                if (parseProgressCallback) {
                    parseProgressCallback(Math.round(percent * 0.8));
                }
            }
        );

        let voxelData = out;
        const affineOrientation = this.getOrientationTransform(view, littleEndian, pixdim);
        const effectiveOrientation = this.composeDisplayOrientation(affineOrientation, activeSpacing);
        const transformed = await this.reorientToCanonicalAsync(
            out,
            originalDimensions,
            activeSpacing,
            effectiveOrientation,
            (percent) => {
                if (parseProgressCallback) {
                    parseProgressCallback(80 + Math.round(percent * 0.2));
                }
            }
        );
        activeDimensions = transformed.dimensions;
        activeSpacing = transformed.spacing;
        voxelData = transformed.data;
        const orientationInfo = this.buildOrientationMetadata(
            affineOrientation,
            effectiveOrientation,
            transformed.data !== out
        );

        const metadata = {
            dimensions: activeDimensions,
            dataType: 'float32',
            spacing: activeSpacing,
            description: dim4 > 1 ? 'NIfTI (first volume)' : 'NIfTI',
            niftiOrientation: orientationInfo
        };

        if (parseProgressCallback) {
            parseProgressCallback(100);
        }

        return { data: voxelData, metadata: metadata };
    }

    async decodeNiftiDataToFloat32(
        dataView,
        datatype,
        littleEndian,
        bytesPerVoxel,
        slope,
        intercept,
        out,
        progressCallback = null
    ) {
        const totalVoxels = out.length;
        if (totalVoxels === 0) {
            if (progressCallback) progressCallback(100);
            return;
        }

        const chunkVoxels = 262144; // 256k voxels per chunk to keep UI responsive.
        if (datatype === 128) {
            let offset = 0;
            for (let start = 0; start < totalVoxels; start += chunkVoxels) {
                const end = Math.min(totalVoxels, start + chunkVoxels);
                for (let idx = start; idx < end; idx++) {
                    const r = dataView.getUint8(offset);
                    const g = dataView.getUint8(offset + 1);
                    const b = dataView.getUint8(offset + 2);
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    out[idx] = gray * slope + intercept;
                    offset += 3;
                }

                if (progressCallback) {
                    progressCallback(Math.round((end / totalVoxels) * 100));
                }
                if (end < totalVoxels) {
                    await this.yieldToUI();
                }
            }
            return;
        }

        for (let start = 0; start < totalVoxels; start += chunkVoxels) {
            const end = Math.min(totalVoxels, start + chunkVoxels);
            let offset = start * bytesPerVoxel;
            for (let idx = start; idx < end; idx++) {
                const value = this.readValue(dataView, offset, datatype, littleEndian);
                out[idx] = value * slope + intercept;
                offset += bytesPerVoxel;
            }

            if (progressCallback) {
                progressCallback(Math.round((end / totalVoxels) * 100));
            }
            if (end < totalVoxels) {
                await this.yieldToUI();
            }
        }
    }

    async parseNiftiHeaderFromFile(file) {
        if (!file) {
            throw new Error('No NIfTI file provided');
        }

        const headerBytes = await file.slice(0, 4096).arrayBuffer();
        const view = new DataView(headerBytes);
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
        const bytesPerVoxel = this.bytesPerVoxel(datatype);
        if (!bytesPerVoxel) {
            throw new Error(`Unsupported NIfTI datatype: ${datatype}`);
        }

        const voxOffset = view.getFloat32(108, littleEndian);
        const slope = view.getFloat32(112, littleEndian);
        const intercept = view.getFloat32(116, littleEndian);

        const pixdim = [];
        for (let i = 0; i < 8; i++) {
            pixdim.push(view.getFloat32(76 + i * 4, littleEndian));
        }

        const rawSpacing = [
            pixdim[1] > 0 ? pixdim[1] : 1.0,
            pixdim[2] > 0 ? pixdim[2] : 1.0,
            pixdim[3] > 0 ? pixdim[3] : 1.0
        ];
        const rawDimensions = [dim1, dim2, dim3];
        const dataOffset = Math.max(0, Math.floor(voxOffset));
        const totalBytes = dim1 * dim2 * dim3 * bytesPerVoxel;

        if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
            throw new Error('Invalid NIfTI voxel payload size');
        }
        if (file.size < dataOffset + totalBytes) {
            throw new Error('NIfTI file appears truncated');
        }

        const affineOrientation = this.getOrientationTransform(view, littleEndian, pixdim);
        const effectiveOrientation = this.composeDisplayOrientation(affineOrientation, rawSpacing);
        const geometry = this.getOutputGeometry(rawDimensions, rawSpacing, effectiveOrientation);
        const orientationInfo = this.buildOrientationMetadata(
            affineOrientation,
            effectiveOrientation,
            this.orientationWouldReorient(effectiveOrientation)
        );

        return {
            littleEndian,
            datatype,
            bytesPerVoxel,
            dim4,
            dataOffset,
            slope: (slope === 0 || !Number.isFinite(slope)) ? 1 : slope,
            intercept: Number.isFinite(intercept) ? intercept : 0,
            rawDimensions,
            rawSpacing,
            affineOrientation,
            effectiveOrientation,
            metadata: {
                dimensions: geometry.dimensions,
                dataType: 'float32',
                spacing: geometry.spacing,
                description: dim4 > 1 ? 'NIfTI (first volume)' : 'NIfTI',
                niftiOrientation: orientationInfo
            }
        };
    }

    async createLowResPreviewFromFile(file, header, downsampleScale = 4, progressCallback = null) {
        if (!file || !header) {
            throw new Error('Missing NIfTI file or header for preview generation');
        }

        const scale = Math.max(1, Math.floor(downsampleScale || 1));
        const [nx, ny, nz] = header.rawDimensions;
        const dstNx = Math.ceil(nx / scale);
        const dstNy = Math.ceil(ny / scale);
        const dstNz = Math.ceil(nz / scale);
        const lowResRaw = new Float32Array(dstNx * dstNy * dstNz);
        const sliceVoxels = nx * ny;
        const sliceBytes = sliceVoxels * header.bytesPerVoxel;

        if (progressCallback) {
            progressCallback(0);
        }
        const reportInterval = Math.max(1, Math.floor(dstNz / 40));

        for (let dz = 0; dz < dstNz; dz++) {
            const srcZ = Math.min(dz * scale, nz - 1);
            const sliceStart = header.dataOffset + srcZ * sliceBytes;
            const sliceBuffer = await file.slice(sliceStart, sliceStart + sliceBytes).arrayBuffer();
            const slice = this.decodeNiftiSliceToFloat32(
                sliceBuffer,
                nx,
                ny,
                header.datatype,
                header.littleEndian,
                header.slope,
                header.intercept
            );

            for (let dy = 0; dy < dstNy; dy++) {
                const srcY = Math.min(dy * scale, ny - 1);
                const srcRow = srcY * nx;
                const dstRow = dy * dstNx + dz * dstNx * dstNy;
                for (let dx = 0; dx < dstNx; dx++) {
                    const srcX = Math.min(dx * scale, nx - 1);
                    lowResRaw[dstRow + dx] = slice[srcRow + srcX];
                }
            }

            if (progressCallback && (dz === 0 || dz === dstNz - 1 || ((dz + 1) % reportInterval === 0))) {
                progressCallback(Math.round(((dz + 1) / dstNz) * 100));
            }
            if ((dz % 8) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        if (progressCallback) {
            progressCallback(100);
        }

        const orientationForLowRes = this.scaleOrientationForDownsample(header.effectiveOrientation, scale);
        const lowResSpacingRaw = header.rawSpacing.map((s) => s * scale);
        const transformed = this.reorientToCanonical(
            lowResRaw,
            [dstNx, dstNy, dstNz],
            lowResSpacingRaw,
            orientationForLowRes
        );
        const range = this.computeMinMax(transformed.data);

        return {
            lowResVolume: {
                dimensions: transformed.dimensions,
                dataType: 'float32',
                spacing: transformed.spacing,
                data: transformed.data,
                min: range.min,
                max: range.max,
                isLowRes: true
            }
        };
    }

    decodeNiftiSliceToFloat32(buffer, width, height, datatype, littleEndian, slope, intercept) {
        const total = width * height;
        const view = new DataView(buffer);
        const out = new Float32Array(total);
        const bytesPerVoxel = this.bytesPerVoxel(datatype);
        if (!bytesPerVoxel) {
            throw new Error(`Unsupported NIfTI datatype: ${datatype}`);
        }

        if (datatype === 128) {
            const maxPixels = Math.min(total, Math.floor(view.byteLength / 3));
            let offset = 0;
            for (let i = 0; i < maxPixels; i++) {
                const r = view.getUint8(offset);
                const g = view.getUint8(offset + 1);
                const b = view.getUint8(offset + 2);
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                out[i] = gray * slope + intercept;
                offset += 3;
            }
            return out;
        }

        const maxVoxels = Math.min(total, Math.floor(view.byteLength / bytesPerVoxel));
        let offset = 0;
        for (let i = 0; i < maxVoxels; i++) {
            out[i] = this.readValue(view, offset, datatype, littleEndian) * slope + intercept;
            offset += bytesPerVoxel;
        }
        return out;
    }

    buildOrientationMetadata(affineOrientation, effectiveOrientation, applied) {
        const fallbackPerm = [0, 1, 2];
        const fallbackSigns = [1, 1, 1];
        const displaySigns = effectiveOrientation && Array.isArray(effectiveOrientation.displaySigns)
            ? effectiveOrientation.displaySigns.slice(0, 3)
            : fallbackSigns;

        return {
            modality: 'nifti',
            source: affineOrientation && affineOrientation.source ? affineOrientation.source : 'none',
            permutation: effectiveOrientation && Array.isArray(effectiveOrientation.permutation)
                ? effectiveOrientation.permutation.slice(0, 3)
                : fallbackPerm,
            signs: effectiveOrientation && Array.isArray(effectiveOrientation.signs)
                ? effectiveOrientation.signs.slice(0, 3)
                : fallbackSigns,
            affinePermutation: affineOrientation && Array.isArray(affineOrientation.permutation)
                ? affineOrientation.permutation.slice(0, 3)
                : fallbackPerm,
            affineSigns: affineOrientation && Array.isArray(affineOrientation.signs)
                ? affineOrientation.signs.slice(0, 3)
                : fallbackSigns,
            displaySigns,
            applied: !!applied
        };
    }

    composeDisplayOrientation(affineOrientation, inputSpacing) {
        const fallbackPerm = [0, 1, 2];
        const fallbackSigns = [1, 1, 1];
        const basePerm = affineOrientation && Array.isArray(affineOrientation.permutation)
            ? affineOrientation.permutation.slice(0, 3)
            : fallbackPerm.slice();
        const baseSigns = affineOrientation && Array.isArray(affineOrientation.signs)
            ? affineOrientation.signs.slice(0, 3)
            : fallbackSigns.slice();
        const spacing = affineOrientation && Array.isArray(affineOrientation.spacing)
            ? affineOrientation.spacing.slice(0, 3)
            : (Array.isArray(inputSpacing) ? inputSpacing.slice(0, 3) : [1, 1, 1]);

        const displaySigns = this.getDisplayConventionSigns();
        const combinedSigns = [
            baseSigns[0] * displaySigns[0],
            baseSigns[1] * displaySigns[1],
            baseSigns[2] * displaySigns[2]
        ];

        return {
            source: affineOrientation && affineOrientation.source ? affineOrientation.source : 'none',
            permutation: basePerm,
            signs: combinedSigns,
            spacing,
            displaySigns
        };
    }

    getDisplayConventionSigns() {
        // Match the viewer's 2D slice convention: X right, Y up, Z up.
        // Since image/canvas Y grows downward, Y and Z are inverted at data level.
        return [1, -1, -1];
    }

    getOrientationTransform(view, littleEndian, pixdim) {
        const qformCode = view.getInt16(252, littleEndian);
        const sformCode = view.getInt16(254, littleEndian);

        let matrix = null;
        let source = 'none';

        if (sformCode > 0) {
            matrix = [
                [
                    view.getFloat32(280, littleEndian),
                    view.getFloat32(284, littleEndian),
                    view.getFloat32(288, littleEndian)
                ],
                [
                    view.getFloat32(296, littleEndian),
                    view.getFloat32(300, littleEndian),
                    view.getFloat32(304, littleEndian)
                ],
                [
                    view.getFloat32(312, littleEndian),
                    view.getFloat32(316, littleEndian),
                    view.getFloat32(320, littleEndian)
                ]
            ];
            source = 'sform';
        } else if (qformCode > 0) {
            matrix = this.buildQFormMatrix(view, littleEndian, pixdim);
            source = 'qform';
        }

        if (!matrix) return null;
        return this.deriveAxisMapFromMatrix(matrix, source);
    }

    buildQFormMatrix(view, littleEndian, pixdim) {
        let qb = view.getFloat32(256, littleEndian);
        let qc = view.getFloat32(260, littleEndian);
        let qd = view.getFloat32(264, littleEndian);
        const qSquared = qb * qb + qc * qc + qd * qd;
        let qa = 0;
        if (qSquared <= 1.0) {
            qa = Math.sqrt(1.0 - qSquared);
        } else {
            const invMag = 1.0 / Math.sqrt(qSquared);
            qa = 0;
            // Renormalize quaternion vector part if header is slightly invalid.
            qb *= invMag;
            qc *= invMag;
            qd *= invMag;
        }

        const dx = pixdim[1] > 0 ? pixdim[1] : 1.0;
        const dy = pixdim[2] > 0 ? pixdim[2] : 1.0;
        const dz = pixdim[3] > 0 ? pixdim[3] : 1.0;
        const qfac = pixdim[0] < 0 ? -1.0 : 1.0;
        const zScale = dz * qfac;

        const r11 = qa * qa + qb * qb - qc * qc - qd * qd;
        const r12 = 2.0 * (qb * qc - qa * qd);
        const r13 = 2.0 * (qb * qd + qa * qc);
        const r21 = 2.0 * (qb * qc + qa * qd);
        const r22 = qa * qa + qc * qc - qb * qb - qd * qd;
        const r23 = 2.0 * (qc * qd - qa * qb);
        const r31 = 2.0 * (qb * qd - qa * qc);
        const r32 = 2.0 * (qc * qd + qa * qb);
        const r33 = qa * qa + qd * qd - qb * qb - qc * qc;

        return [
            [r11 * dx, r12 * dy, r13 * zScale],
            [r21 * dx, r22 * dy, r23 * zScale],
            [r31 * dx, r32 * dy, r33 * zScale]
        ];
    }

    deriveAxisMapFromMatrix(matrix, source) {
        const norms = this.getColumnNorms(matrix);
        if (norms.some((v) => !Number.isFinite(v) || v <= 0)) return null;

        const normalized = [
            [matrix[0][0] / norms[0], matrix[0][1] / norms[1], matrix[0][2] / norms[2]],
            [matrix[1][0] / norms[0], matrix[1][1] / norms[1], matrix[1][2] / norms[2]],
            [matrix[2][0] / norms[0], matrix[2][1] / norms[1], matrix[2][2] / norms[2]]
        ];

        const permutations = [
            [0, 1, 2],
            [0, 2, 1],
            [1, 0, 2],
            [1, 2, 0],
            [2, 0, 1],
            [2, 1, 0]
        ];

        let bestPerm = permutations[0];
        let bestScore = -Infinity;
        for (const perm of permutations) {
            const score =
                Math.abs(normalized[0][perm[0]]) +
                Math.abs(normalized[1][perm[1]]) +
                Math.abs(normalized[2][perm[2]]);
            if (score > bestScore) {
                bestScore = score;
                bestPerm = perm;
            }
        }

        const signs = [
            normalized[0][bestPerm[0]] >= 0 ? 1 : -1,
            normalized[1][bestPerm[1]] >= 0 ? 1 : -1,
            normalized[2][bestPerm[2]] >= 0 ? 1 : -1
        ];

        return {
            source,
            permutation: bestPerm.slice(),
            signs,
            spacing: norms
        };
    }

    getColumnNorms(matrix) {
        const c0 = Math.hypot(matrix[0][0], matrix[1][0], matrix[2][0]);
        const c1 = Math.hypot(matrix[0][1], matrix[1][1], matrix[2][1]);
        const c2 = Math.hypot(matrix[0][2], matrix[1][2], matrix[2][2]);
        return [c0, c1, c2];
    }

    orientationWouldReorient(orientation) {
        if (!orientation || !orientation.permutation || !orientation.signs) return false;
        const p = orientation.permutation;
        const s = orientation.signs;
        return !(p[0] === 0 && p[1] === 1 && p[2] === 2 && s[0] === 1 && s[1] === 1 && s[2] === 1);
    }

    getOutputGeometry(inputDims, inputSpacing, orientation) {
        if (!orientation || !orientation.permutation || !orientation.signs) {
            return {
                dimensions: inputDims.slice(),
                spacing: inputSpacing.slice()
            };
        }

        const perm = orientation.permutation;
        const spacingSource = (orientation.spacing && orientation.spacing.length === 3)
            ? orientation.spacing
            : inputSpacing;
        return {
            dimensions: [inputDims[perm[0]], inputDims[perm[1]], inputDims[perm[2]]],
            spacing: [
                spacingSource[perm[0]] || inputSpacing[perm[0]] || 1.0,
                spacingSource[perm[1]] || inputSpacing[perm[1]] || 1.0,
                spacingSource[perm[2]] || inputSpacing[perm[2]] || 1.0
            ]
        };
    }

    scaleOrientationForDownsample(orientation, scale) {
        if (!orientation) return null;
        const spacing = Array.isArray(orientation.spacing)
            ? orientation.spacing.map((v) => (Number.isFinite(v) ? v * scale : v))
            : null;
        return {
            ...orientation,
            spacing
        };
    }

    computeMinMax(data) {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (value < min) min = value;
            if (value > max) max = value;
        }
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            return { min: 0, max: 1 };
        }
        return { min, max };
    }

    async reorientToCanonicalAsync(data, inputDims, inputSpacing, orientation, progressCallback = null) {
        if (!orientation || !orientation.permutation || !orientation.signs) {
            if (progressCallback) {
                progressCallback(100);
            }
            return {
                data,
                dimensions: inputDims.slice(),
                spacing: inputSpacing.slice()
            };
        }

        const perm = orientation.permutation;
        const signs = orientation.signs;
        const dimsOut = [inputDims[perm[0]], inputDims[perm[1]], inputDims[perm[2]]];

        const spacingSource = (orientation.spacing && orientation.spacing.length === 3)
            ? orientation.spacing
            : inputSpacing;
        const spacingOut = [
            spacingSource[perm[0]] || inputSpacing[perm[0]] || 1.0,
            spacingSource[perm[1]] || inputSpacing[perm[1]] || 1.0,
            spacingSource[perm[2]] || inputSpacing[perm[2]] || 1.0
        ];

        const isIdentityPermutation = perm[0] === 0 && perm[1] === 1 && perm[2] === 2;
        const isIdentitySigns = signs[0] === 1 && signs[1] === 1 && signs[2] === 1;
        if (isIdentityPermutation && isIdentitySigns) {
            if (progressCallback) {
                progressCallback(100);
            }
            return {
                data,
                dimensions: dimsOut,
                spacing: spacingOut
            };
        }

        const [nx, ny] = inputDims;
        const [ox, oy, oz] = dimsOut;
        const output = new Float32Array(data.length);
        const inputStrideY = nx;
        const inputStrideZ = nx * ny;
        const outputStrideY = ox;
        const outputStrideZ = ox * oy;
        const zChunk = Math.max(1, Math.floor(4 * 1024 * 1024 / Math.max(1, ox * oy)));

        for (let zStart = 0; zStart < oz; zStart += zChunk) {
            const zEnd = Math.min(oz, zStart + zChunk);
            for (let z = zStart; z < zEnd; z++) {
                for (let y = 0; y < oy; y++) {
                    for (let x = 0; x < ox; x++) {
                        const coord = [x, y, z];
                        const src = [0, 0, 0];

                        for (let outAxis = 0; outAxis < 3; outAxis++) {
                            const inAxis = perm[outAxis];
                            const dim = inputDims[inAxis];
                            src[inAxis] = signs[outAxis] > 0
                                ? coord[outAxis]
                                : (dim - 1 - coord[outAxis]);
                        }

                        const srcIndex = src[0] + src[1] * inputStrideY + src[2] * inputStrideZ;
                        const dstIndex = x + y * outputStrideY + z * outputStrideZ;
                        output[dstIndex] = data[srcIndex];
                    }
                }
            }

            if (progressCallback) {
                progressCallback(Math.round((zEnd / oz) * 100));
            }
            if (zEnd < oz) {
                await this.yieldToUI();
            }
        }

        return {
            data: output,
            dimensions: dimsOut,
            spacing: spacingOut
        };
    }

    yieldToUI() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    reorientToCanonical(data, inputDims, inputSpacing, orientation, progressCallback = null) {
        if (!orientation || !orientation.permutation || !orientation.signs) {
            if (progressCallback) {
                progressCallback(100);
            }
            return {
                data,
                dimensions: inputDims.slice(),
                spacing: inputSpacing.slice()
            };
        }

        const perm = orientation.permutation;
        const signs = orientation.signs;
        const dimsOut = [inputDims[perm[0]], inputDims[perm[1]], inputDims[perm[2]]];

        const spacingSource = (orientation.spacing && orientation.spacing.length === 3)
            ? orientation.spacing
            : inputSpacing;
        const spacingOut = [
            spacingSource[perm[0]] || inputSpacing[perm[0]] || 1.0,
            spacingSource[perm[1]] || inputSpacing[perm[1]] || 1.0,
            spacingSource[perm[2]] || inputSpacing[perm[2]] || 1.0
        ];

        const isIdentityPermutation = perm[0] === 0 && perm[1] === 1 && perm[2] === 2;
        const isIdentitySigns = signs[0] === 1 && signs[1] === 1 && signs[2] === 1;
        if (isIdentityPermutation && isIdentitySigns) {
            if (progressCallback) {
                progressCallback(100);
            }
            return {
                data,
                dimensions: dimsOut,
                spacing: spacingOut
            };
        }

        const [nx, ny, nz] = inputDims;
        const [ox, oy, oz] = dimsOut;
        const output = new Float32Array(data.length);
        const inputStrideY = nx;
        const inputStrideZ = nx * ny;
        const outputStrideY = ox;
        const outputStrideZ = ox * oy;
        const progressIntervalZ = Math.max(1, Math.floor(oz / 60));

        for (let z = 0; z < oz; z++) {
            for (let y = 0; y < oy; y++) {
                for (let x = 0; x < ox; x++) {
                    const coord = [x, y, z];
                    const src = [0, 0, 0];

                    for (let outAxis = 0; outAxis < 3; outAxis++) {
                        const inAxis = perm[outAxis];
                        const dim = inputDims[inAxis];
                        src[inAxis] = signs[outAxis] > 0
                            ? coord[outAxis]
                            : (dim - 1 - coord[outAxis]);
                    }

                    const srcIndex = src[0] + src[1] * inputStrideY + src[2] * inputStrideZ;
                    const dstIndex = x + y * outputStrideY + z * outputStrideZ;
                    output[dstIndex] = data[srcIndex];
                }
            }
            if (progressCallback && (z === 0 || z === oz - 1 || ((z + 1) % progressIntervalZ === 0))) {
                progressCallback(Math.round(((z + 1) / oz) * 100));
            }
        }

        return {
            data: output,
            dimensions: dimsOut,
            spacing: spacingOut
        };
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
