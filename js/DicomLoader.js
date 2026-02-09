class DicomLoader {
    constructor() {
        this.longLengthVR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
        this.tagVR = {
            '0008,0060': 'CS', // Modality
            '0008,103e': 'LO', // SeriesDescription
            '0018,0050': 'DS', // SliceThickness
            '0018,0088': 'DS', // SpacingBetweenSlices
            '0020,000E': 'UI', // SeriesInstanceUID
            '0020,0013': 'IS', // InstanceNumber
            '0020,0032': 'DS', // ImagePositionPatient
            '0020,0037': 'DS', // ImageOrientationPatient
            '0028,0002': 'US', // SamplesPerPixel
            '0028,0004': 'CS', // PhotometricInterpretation
            '0028,0008': 'IS', // NumberOfFrames
            '0028,0010': 'US', // Rows
            '0028,0011': 'US', // Columns
            '0028,0030': 'DS', // PixelSpacing
            '0028,0100': 'US', // BitsAllocated
            '0028,0101': 'US', // BitsStored
            '0028,0103': 'US', // PixelRepresentation
            '0028,1052': 'DS', // RescaleIntercept
            '0028,1053': 'DS' // RescaleSlope
        };
    }

    async isDicomFile(file) {
        if (!file || file.size < 132) return false;
        const buffer = await file.slice(0, 132).arrayBuffer();
        const view = new DataView(buffer);
        const magic = view.getUint32(128, false);
        if (magic === 0x4449434d) return true; // 'DICM'
        // Heuristic: some vendors omit the preamble
        return this.isLikelyDicomWithoutPreamble(view);
    }

    getTransferSyntax(transferSyntaxUID) {
        const ts = {
            '1.2.840.10008.1.2': { explicitVR: false, littleEndian: true, compressed: false }, // Implicit VR LE
            '1.2.840.10008.1.2.1': { explicitVR: true, littleEndian: true, compressed: false }, // Explicit VR LE
            '1.2.840.10008.1.2.2': { explicitVR: true, littleEndian: false, compressed: false } // Explicit VR BE
        };
        return ts[transferSyntaxUID] || null;
    }

    async scanSeries(files) {
        const seriesMap = new Map();
        const results = [];
        let warnedMissingSeriesUid = false;

        for (const file of files) {
            try {
                const info = await this.parseDicomFile(file, { headerOnly: true });
                let seriesKey = null;
                if (info && info.seriesUID && info.seriesUID.trim()) {
                    seriesKey = info.seriesUID.trim();
                } else if (info) {
                    seriesKey = this.buildFallbackSeriesKey(info);
                    if (seriesKey && !warnedMissingSeriesUid) {
                        console.warn('DICOM SeriesInstanceUID missing; grouping slices by fallback metadata.');
                        warnedMissingSeriesUid = true;
                    }
                }

                if (!info || !seriesKey) {
                    const key = `unknown-${file.name}`;
                    seriesMap.set(key, {
                        type: 'dicom-series',
                        seriesUID: key,
                        name: file.name,
                        files: [file]
                    });
                    continue;
                }

                if (!seriesMap.has(seriesKey)) {
                    seriesMap.set(seriesKey, {
                        type: 'dicom-series',
                        seriesUID: seriesKey,
                        name: info.seriesDescription || seriesKey,
                        files: []
                    });
                }

                seriesMap.get(seriesKey).files.push(file);
            } catch (e) {
                console.warn(`Skipping file ${file.name}: ${e.message}`);
            }
        }

        seriesMap.forEach(value => results.push(value));
        return results;
    }

    buildFallbackSeriesKey(info) {
        const parts = [];

        if (info.seriesDescription) {
            parts.push(`desc=${info.seriesDescription}`);
        }

        if (Number.isFinite(info.rows) && Number.isFinite(info.cols)) {
            parts.push(`size=${info.cols}x${info.rows}`);
        }

        if (Number.isFinite(info.bitsAllocated)) {
            parts.push(`bits=${info.bitsAllocated}`);
        }

        if (Number.isFinite(info.samplesPerPixel)) {
            parts.push(`spp=${info.samplesPerPixel}`);
        }

        if (info.photometricInterpretation) {
            parts.push(`photo=${info.photometricInterpretation}`);
        }

        if (Array.isArray(info.imageOrientation) && info.imageOrientation.length) {
            const orient = info.imageOrientation.map((v) => Number(v).toFixed(5)).join(',');
            parts.push(`orient=${orient}`);
        }

        if (Array.isArray(info.pixelSpacing) && info.pixelSpacing.length) {
            const spacing = info.pixelSpacing.map((v) => Number(v).toFixed(5)).join(',');
            parts.push(`spacing=${spacing}`);
        }

        return parts.length ? `fallback:${parts.join('|')}` : null;
    }

    async loadSeries(seriesGroup, progressCallback) {
        if (!seriesGroup || !seriesGroup.files || seriesGroup.files.length === 0) {
            throw new Error('No DICOM files provided');
        }

        const files = seriesGroup.files;
        const sliceInfos = [];

        if (progressCallback) {
            progressCallback({ stage: 'metadata', progress: 0 });
        }

        for (let i = 0; i < files.length; i++) {
            const info = await this.parseDicomFile(files[i], { headerOnly: false });
            sliceInfos.push(info);

            if (progressCallback) {
                progressCallback({
                    stage: 'loading',
                    progress: Math.round(((i + 1) / files.length) * 100)
                });
            }
        }

        // Handle multi-frame DICOM (single file with multiple frames)
        if (sliceInfos.length === 1 && sliceInfos[0].numberOfFrames > 1) {
            return this.buildMultiFrameVolume(sliceInfos[0]);
        }

        return this.buildSeriesVolume(sliceInfos);
    }

    buildSeriesVolume(sliceInfos) {
        if (sliceInfos.length === 0) {
            throw new Error('No DICOM slices parsed');
        }

        const ref = sliceInfos[0];
        const rows = ref.rows;
        const cols = ref.cols;
        const sliceSize = rows * cols;

        for (const info of sliceInfos) {
            if (info.rows !== rows || info.cols !== cols) {
                throw new Error('DICOM series has inconsistent slice dimensions');
            }
        }

        const sorted = this.sortSlices(sliceInfos);
        const numSlices = sorted.length;
        const volumeData = new Float32Array(sliceSize * numSlices);

        let min = Infinity;
        let max = -Infinity;

        for (let z = 0; z < numSlices; z++) {
            const slice = sorted[z];
            const scaled = this.applyRescale(slice.pixelData, slice.rescaleSlope, slice.rescaleIntercept);

            volumeData.set(scaled, z * sliceSize);

            for (let i = 0; i < scaled.length; i++) {
                const value = scaled[i];
                if (value < min) min = value;
                if (value > max) max = value;
            }
        }

        const spacing = this.computeSpacing(sorted, ref);
        const metadata = {
            dimensions: [cols, rows, numSlices],
            dataType: 'float32',
            spacing: spacing,
            min: min,
            max: max,
            description: ref.seriesDescription || 'DICOM Series'
        };

        return new VolumeData(volumeData.buffer, metadata);
    }

    buildMultiFrameVolume(info) {
        const rows = info.rows;
        const cols = info.cols;
        const frames = info.numberOfFrames;
        const sliceSize = rows * cols;

        const expectedLength = sliceSize * frames;
        if (info.pixelData.length < expectedLength) {
            throw new Error('Multi-frame pixel data length mismatch');
        }

        const volumeData = new Float32Array(sliceSize * frames);
        let min = Infinity;
        let max = -Infinity;

        for (let f = 0; f < frames; f++) {
            const frameOffset = f * sliceSize;
            const frameView = info.pixelData.subarray(frameOffset, frameOffset + sliceSize);
            const scaled = this.applyRescale(frameView, info.rescaleSlope, info.rescaleIntercept);
            volumeData.set(scaled, frameOffset);

            for (let i = 0; i < scaled.length; i++) {
                const value = scaled[i];
                if (value < min) min = value;
                if (value > max) max = value;
            }
        }

        const spacing = this.computeSpacing([info], info);
        const metadata = {
            dimensions: [cols, rows, frames],
            dataType: 'float32',
            spacing: spacing,
            min: min,
            max: max,
            description: info.seriesDescription || 'DICOM Multi-frame'
        };

        return new VolumeData(volumeData.buffer, metadata);
    }

    applyRescale(data, slope, intercept) {
        const s = (slope === undefined || slope === null || slope === 0) ? 1 : slope;
        const i = intercept || 0;
        const out = new Float32Array(data.length);

        for (let idx = 0; idx < data.length; idx++) {
            out[idx] = data[idx] * s + i;
        }

        return out;
    }

    sortSlices(sliceInfos) {
        const withPosition = sliceInfos.filter(s => Array.isArray(s.imagePosition) && s.imagePosition.length === 3);
        const hasOrientation = Array.isArray(sliceInfos[0].imageOrientation) && sliceInfos[0].imageOrientation.length === 6;

        if (withPosition.length === sliceInfos.length && hasOrientation) {
            const normal = this.computeNormal(sliceInfos[0].imageOrientation);
            return sliceInfos
                .map(s => ({
                    info: s,
                    location: this.dot(s.imagePosition, normal)
                }))
                .sort((a, b) => a.location - b.location)
                .map(s => s.info);
        }

        if (withPosition.length === sliceInfos.length) {
            return sliceInfos
                .map(s => ({ info: s, location: s.imagePosition[2] }))
                .sort((a, b) => a.location - b.location)
                .map(s => s.info);
        }

        if (sliceInfos.every(s => s.instanceNumber !== null && s.instanceNumber !== undefined)) {
            return sliceInfos
                .slice()
                .sort((a, b) => a.instanceNumber - b.instanceNumber);
        }

        return sliceInfos;
    }

    computeSpacing(sortedSlices, ref) {
        let spacingZ = 1.0;
        const positions = sortedSlices
            .filter(s => Array.isArray(s.imagePosition) && s.imagePosition.length === 3)
            .map(s => s.imagePosition);

        if (positions.length >= 2) {
            const hasOrientation = Array.isArray(ref.imageOrientation) && ref.imageOrientation.length === 6;
            if (hasOrientation) {
                const normal = this.computeNormal(ref.imageOrientation);
                const locations = positions.map(p => this.dot(p, normal));
                spacingZ = this.averageDiffs(locations);
            } else {
                const distances = [];
                for (let i = 1; i < positions.length; i++) {
                    const dx = positions[i][0] - positions[i - 1][0];
                    const dy = positions[i][1] - positions[i - 1][1];
                    const dz = positions[i][2] - positions[i - 1][2];
                    distances.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
                }
                spacingZ = this.average(distances) || spacingZ;
            }
        } else if (ref.spacingBetweenSlices) {
            spacingZ = ref.spacingBetweenSlices;
        } else if (ref.sliceThickness) {
            spacingZ = ref.sliceThickness;
        }

        const pixelSpacing = ref.pixelSpacing || [1.0, 1.0];
        const rowSpacing = pixelSpacing[0] || 1.0;
        const colSpacing = pixelSpacing[1] || 1.0;

        return [colSpacing, rowSpacing, spacingZ || 1.0];
    }

    averageDiffs(values) {
        if (!values || values.length < 2) return 1.0;
        const diffs = [];
        for (let i = 1; i < values.length; i++) {
            diffs.push(Math.abs(values[i] - values[i - 1]));
        }
        return this.average(diffs) || 1.0;
    }

    average(values) {
        if (!values || values.length === 0) return 0;
        const sum = values.reduce((a, b) => a + b, 0);
        return sum / values.length;
    }

    computeNormal(orientation) {
        const row = orientation.slice(0, 3);
        const col = orientation.slice(3, 6);
        return [
            row[1] * col[2] - row[2] * col[1],
            row[2] * col[0] - row[0] * col[2],
            row[0] * col[1] - row[1] * col[0]
        ];
    }

    dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    async parseDicomFile(file, options = {}) {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);

        let offset = 0;
        const meta = {};
        let explicitVR = true;
        let littleEndian = true;
        let transferSyntaxUID = null;

        if (this.hasPreamble(view)) {
            offset = 132;
            offset = this.parseMetaHeader(view, offset, meta);
            transferSyntaxUID = meta.transferSyntaxUID || '1.2.840.10008.1.2.1';
            const ts = this.getTransferSyntax(transferSyntaxUID);
            if (!ts) {
                throw new Error(`Unsupported transfer syntax: ${transferSyntaxUID}`);
            }
            if (ts.compressed) {
                throw new Error('Compressed DICOM not supported');
            }
            if (!ts.littleEndian) {
                throw new Error('Big-endian DICOM not supported');
            }
            explicitVR = ts.explicitVR;
            littleEndian = ts.littleEndian;
        } else {
            // No preamble: assume little-endian, guess explicit VR based on first tag
            explicitVR = this.guessExplicitVR(view);
            littleEndian = true;
        }

        const info = {
            file,
            transferSyntaxUID,
            explicitVR: explicitVR,
            littleEndian: littleEndian,
            rows: null,
            cols: null,
            bitsAllocated: null,
            pixelRepresentation: 0,
            samplesPerPixel: 1,
            photometricInterpretation: null,
            pixelSpacing: null,
            imagePosition: null,
            imageOrientation: null,
            instanceNumber: null,
            seriesUID: null,
            seriesDescription: null,
            rescaleIntercept: 0,
            rescaleSlope: 1,
            sliceThickness: null,
            spacingBetweenSlices: null,
            numberOfFrames: 1,
            pixelDataOffset: null,
            pixelDataLength: null,
            pixelData: null
        };

        while (offset < view.byteLength) {
            const element = this.readElement(view, offset, info.explicitVR, info.littleEndian);
            if (!element) break;

            if (element.tagKey === '7fe0,0010') {
                if (element.length === 0xffffffff) {
                    throw new Error('Encapsulated (compressed) pixel data not supported');
                }
                info.pixelDataOffset = element.valueOffset;
                info.pixelDataLength = element.length;
                offset = element.nextOffset;
                break;
            }

            if (element.length === 0xffffffff) {
                offset = this.skipUndefinedLength(view, element.valueOffset, info.explicitVR, info.littleEndian);
                continue;
            }

            this.readTagValue(view, element, info);
            offset = element.nextOffset;
        }

        if (!info.rows || !info.cols || !info.bitsAllocated) {
            throw new Error('Missing required image metadata');
        }

        if (info.samplesPerPixel !== 1) {
            throw new Error('Only single-sample (monochrome) DICOM is supported');
        }

        if (!options.headerOnly) {
            info.pixelData = this.extractPixelData(view, info);
        }

        return info;
    }

    hasPreamble(view) {
        if (view.byteLength < 132) return false;
        const magic = view.getUint32(128, false);
        return magic === 0x4449434d;
    }

    isLikelyDicomWithoutPreamble(view) {
        if (view.byteLength < 8) return false;
        const group = view.getUint16(0, true);
        const element = view.getUint16(2, true);
        if (group % 2 !== 0) return false;
        const plausibleGroups = new Set([0x0008, 0x0010, 0x0020, 0x0028, 0x7fe0]);
        if (!plausibleGroups.has(group) && group > 0x7fe0) return false;
        return element <= 0xffff;
    }

    guessExplicitVR(view) {
        if (view.byteLength < 8) return true;
        const vrBytes = [view.getUint8(4), view.getUint8(5)];
        const vr = String.fromCharCode(vrBytes[0], vrBytes[1]);
        const known = this.longLengthVR;
        const validVR = new Set([
            'AE','AS','AT','CS','DA','DS','DT','FD','FL','IS','LO','LT','OB','OD','OF','OL','OW',
            'PN','SH','SL','SQ','SS','ST','TM','UC','UI','UL','UN','UR','US','UT'
        ]);
        if (validVR.has(vr)) return true;
        return false;
    }

    parseMetaHeader(view, offset, meta) {
        while (offset + 8 < view.byteLength) {
            const group = view.getUint16(offset, true);
            if (group !== 0x0002) break;

            const element = this.readElement(view, offset, true, true);
            if (!element) break;

            if (element.tagKey === '0002,0010') {
                meta.transferSyntaxUID = this.readString(view, element.valueOffset, element.length);
            }

            offset = element.nextOffset;
        }

        return offset;
    }

    readElement(view, offset, explicitVR, littleEndian) {
        if (offset + 8 > view.byteLength) return null;

        const group = view.getUint16(offset, littleEndian);
        const element = view.getUint16(offset + 2, littleEndian);
        const tagKey = this.tagKey(group, element);
        offset += 4;

        let vr = null;
        let length = 0;

        if (explicitVR) {
            vr = this.readVR(view, offset);
            offset += 2;

            if (this.longLengthVR.has(vr)) {
                offset += 2; // reserved
                length = view.getUint32(offset, littleEndian);
                offset += 4;
            } else {
                length = view.getUint16(offset, littleEndian);
                offset += 2;
            }
        } else {
            vr = this.tagVR[tagKey] || 'UN';
            length = view.getUint32(offset, littleEndian);
            offset += 4;
        }

        return {
            group,
            element,
            tagKey,
            vr,
            length,
            valueOffset: offset,
            nextOffset: length === 0xffffffff ? offset : offset + length
        };
    }

    skipUndefinedLength(view, offset, explicitVR, littleEndian) {
        let cursor = offset;

        while (cursor + 8 <= view.byteLength) {
            const group = view.getUint16(cursor, littleEndian);
            const element = view.getUint16(cursor + 2, littleEndian);
            const length = view.getUint32(cursor + 4, littleEndian);
            cursor += 8;

            if (group === 0xfffe && element === 0xe0dd) {
                return cursor + length;
            }

            if (group === 0xfffe && element === 0xe000) {
                if (length === 0xffffffff) {
                    cursor = this.skipItemUndefinedLength(view, cursor, explicitVR, littleEndian);
                } else {
                    cursor += length;
                }
                continue;
            }

            cursor += length;
        }

        return cursor;
    }

    skipItemUndefinedLength(view, offset, explicitVR, littleEndian) {
        let cursor = offset;
        while (cursor + 8 <= view.byteLength) {
            const group = view.getUint16(cursor, littleEndian);
            const element = view.getUint16(cursor + 2, littleEndian);

            if (group === 0xfffe && element === 0xe00d) {
                return cursor + 8;
            }

            const elementData = this.readElement(view, cursor, explicitVR, littleEndian);
            if (!elementData) return cursor;

            if (elementData.length === 0xffffffff) {
                cursor = this.skipUndefinedLength(view, elementData.valueOffset, explicitVR, littleEndian);
            } else {
                cursor = elementData.nextOffset;
            }
        }
        return cursor;
    }

    readTagValue(view, element, info) {
        const key = element.tagKey;
        const vr = element.vr;

        switch (key) {
            case '0008,0060':
                info.modality = this.readString(view, element.valueOffset, element.length);
                break;
            case '0008,103e':
                info.seriesDescription = this.readString(view, element.valueOffset, element.length);
                break;
            case '0018,0050':
                info.sliceThickness = this.readNumber(view, element.valueOffset, element.length);
                break;
            case '0018,0088':
                info.spacingBetweenSlices = this.readNumber(view, element.valueOffset, element.length);
                break;
            case '0020,000e':
                info.seriesUID = this.readString(view, element.valueOffset, element.length);
                break;
            case '0020,0013':
                info.instanceNumber = this.readIntString(view, element.valueOffset, element.length);
                break;
            case '0020,0032':
                info.imagePosition = this.readNumberList(view, element.valueOffset, element.length, 3);
                break;
            case '0020,0037':
                info.imageOrientation = this.readNumberList(view, element.valueOffset, element.length, 6);
                break;
            case '0028,0002':
                info.samplesPerPixel = this.readUint16(view, element.valueOffset, info.littleEndian);
                break;
            case '0028,0004':
                info.photometricInterpretation = this.readString(view, element.valueOffset, element.length);
                break;
            case '0028,0008':
                info.numberOfFrames = this.readIntString(view, element.valueOffset, element.length) || 1;
                break;
            case '0028,0010':
                info.rows = this.readUint16(view, element.valueOffset, info.littleEndian);
                break;
            case '0028,0011':
                info.cols = this.readUint16(view, element.valueOffset, info.littleEndian);
                break;
            case '0028,0030':
                info.pixelSpacing = this.readNumberList(view, element.valueOffset, element.length, 2);
                break;
            case '0028,0100':
                info.bitsAllocated = this.readUint16(view, element.valueOffset, info.littleEndian);
                break;
            case '0028,0103':
                info.pixelRepresentation = this.readUint16(view, element.valueOffset, info.littleEndian);
                break;
            case '0028,1052':
                info.rescaleIntercept = this.readNumber(view, element.valueOffset, element.length);
                break;
            case '0028,1053':
                info.rescaleSlope = this.readNumber(view, element.valueOffset, element.length);
                break;
            default:
                if (vr === 'SQ') {
                    return;
                }
        }
    }

    extractPixelData(view, info) {
        if (info.pixelDataOffset === null || info.pixelDataLength === null) {
            throw new Error('Pixel data not found');
        }

        const end = info.pixelDataOffset + info.pixelDataLength;
        if (end > view.byteLength) {
            throw new Error('Pixel data extends beyond file length');
        }

        if (info.bitsAllocated !== 8 && info.bitsAllocated !== 16) {
            throw new Error(`Unsupported BitsAllocated: ${info.bitsAllocated}`);
        }

        const buffer = view.buffer.slice(info.pixelDataOffset, end);

        if (info.bitsAllocated === 8) {
            return new Uint8Array(buffer);
        }

        if (info.pixelRepresentation === 1) {
            return new Int16Array(buffer);
        }

        return new Uint16Array(buffer);
    }

    readVR(view, offset) {
        const a = view.getUint8(offset);
        const b = view.getUint8(offset + 1);
        return String.fromCharCode(a, b);
    }

    readString(view, offset, length) {
        const bytes = new Uint8Array(view.buffer, offset, length);
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0) break;
            result += String.fromCharCode(bytes[i]);
        }
        return result.trim();
    }

    readUint16(view, offset, littleEndian) {
        return view.getUint16(offset, littleEndian);
    }

    readNumber(view, offset, length) {
        const str = this.readString(view, offset, length);
        const val = parseFloat(str);
        return Number.isFinite(val) ? val : null;
    }

    readIntString(view, offset, length) {
        const str = this.readString(view, offset, length);
        const val = parseInt(str, 10);
        return Number.isFinite(val) ? val : null;
    }

    readNumberList(view, offset, length, expected) {
        const str = this.readString(view, offset, length);
        const parts = str.split('\\').map(s => parseFloat(s)).filter(v => Number.isFinite(v));
        if (expected && parts.length >= expected) {
            return parts.slice(0, expected);
        }
        return parts.length ? parts : null;
    }

    tagKey(group, element) {
        const g = group.toString(16).padStart(4, '0');
        const e = element.toString(16).padStart(4, '0');
        return `${g},${e}`;
    }
}
