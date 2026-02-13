/**
 * Stream-oriented TIFF reader for large single files.
 * Supports classic TIFF (32-bit offsets), uncompressed strips, chunky planar data.
 */
class TiffStreamReader {
    constructor(file) {
        this.file = file;
        this.littleEndian = true;
        this.firstIfdOffset = 0;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        if (!this.file) {
            throw new Error('No TIFF file provided');
        }

        const header = await this.readBytes(0, 8);
        const view = new DataView(header);
        const b0 = view.getUint8(0);
        const b1 = view.getUint8(1);

        if (b0 === 0x49 && b1 === 0x49) {
            this.littleEndian = true;
        } else if (b0 === 0x4d && b1 === 0x4d) {
            this.littleEndian = false;
        } else {
            throw new Error('Invalid TIFF byte order');
        }

        const magic = view.getUint16(2, this.littleEndian);
        if (magic === 43) {
            throw new Error('BigTIFF is not supported');
        }
        if (magic !== 42) {
            throw new Error(`Invalid TIFF magic: ${magic}`);
        }

        this.firstIfdOffset = view.getUint32(4, this.littleEndian);
        this.initialized = true;
    }

    async scanPages() {
        await this.initialize();

        const pages = [];
        let offset = this.firstIfdOffset;
        let guard = 0;

        while (offset > 0 && offset + 2 <= this.file.size && guard < 100000) {
            const parsed = await this.parseIfd(offset);
            pages.push(parsed.page);
            offset = parsed.nextIfdOffset;
            guard++;
        }

        if (guard >= 100000) {
            throw new Error('Exceeded TIFF IFD traversal limit');
        }

        return pages;
    }

    canStreamPage(page) {
        return this.getUnsupportedReason(page) === null;
    }

    getUnsupportedReason(page) {
        if (!page) return 'Missing page metadata';
        if (!Array.isArray(page.stripOffsets) || page.stripOffsets.length === 0) {
            return 'Missing strip offsets';
        }
        if (page.tileWidth || page.tileLength) {
            return 'Tiled TIFF is not supported in streaming mode';
        }
        if (page.compression !== 1) {
            return `Compression ${page.compression} is not supported in streaming mode`;
        }
        if (page.planarConfig !== 1) {
            return `Planar configuration ${page.planarConfig} is not supported`;
        }
        if (page.bitsPerSample !== 8 && page.bitsPerSample !== 16) {
            return `BitsPerSample ${page.bitsPerSample} is not supported`;
        }
        if (page.samplesPerPixel !== 1 && page.samplesPerPixel < 3) {
            return `SamplesPerPixel ${page.samplesPerPixel} is not supported`;
        }
        return null;
    }

    async decodePageToGrayDownsampled(page, sx, sy, outW, outH, targetType = 'uint8') {
        const out = targetType === 'uint16'
            ? new Uint16Array(outW * outH)
            : new Uint8Array(outW * outH);

        const stripRows = Math.max(1, Math.min(page.rowsPerStrip || page.height, page.height));
        const bytesPerSample = Math.max(1, Math.ceil(page.bitsPerSample / 8));
        const bytesPerPixel = bytesPerSample * page.samplesPerPixel;
        const rowBytes = page.width * bytesPerPixel;

        let cachedStripIndex = -1;
        let cachedStripBuffer = null;
        let cachedStripView = null;
        let cachedRowsInStrip = 0;

        for (let dy = 0; dy < outH; dy++) {
            const srcY = Math.min(dy * sy, page.height - 1);
            const stripIndex = Math.floor(srcY / stripRows);

            if (stripIndex !== cachedStripIndex) {
                cachedStripIndex = stripIndex;
                cachedRowsInStrip = Math.min(stripRows, page.height - stripIndex * stripRows);
                cachedStripBuffer = await this.readStripBuffer(page, stripIndex, rowBytes, cachedRowsInStrip);
                cachedStripView = new DataView(cachedStripBuffer);
            }

            const rowInStrip = srcY - stripIndex * stripRows;
            const rowBase = rowInStrip * rowBytes;

            for (let dx = 0; dx < outW; dx++) {
                const srcX = Math.min(dx * sx, page.width - 1);
                const pixelBase = rowBase + srcX * bytesPerPixel;

                let gray = 0;
                if (page.samplesPerPixel === 1) {
                    gray = this.readSample(cachedStripView, pixelBase, page.bitsPerSample);
                } else {
                    const rRaw = this.readSample(cachedStripView, pixelBase, page.bitsPerSample);
                    const gRaw = this.readSample(cachedStripView, pixelBase + bytesPerSample, page.bitsPerSample);
                    const bRaw = this.readSample(cachedStripView, pixelBase + bytesPerSample * 2, page.bitsPerSample);
                    const r = page.bitsPerSample === 16 ? (rRaw >> 8) : rRaw;
                    const g = page.bitsPerSample === 16 ? (gRaw >> 8) : gRaw;
                    const b = page.bitsPerSample === 16 ? (bRaw >> 8) : bRaw;
                    gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                }

                const outIdx = dx + dy * outW;
                if (targetType === 'uint16') {
                    if (page.bitsPerSample === 16 && page.samplesPerPixel === 1) {
                        out[outIdx] = gray;
                    } else {
                        out[outIdx] = gray * 257;
                    }
                } else {
                    if (page.bitsPerSample === 16 && page.samplesPerPixel === 1) {
                        out[outIdx] = gray > 255 ? (gray >> 8) : gray;
                    } else {
                        out[outIdx] = gray > 255 ? 255 : gray;
                    }
                }
            }
        }

        return out;
    }

    async decodePageToRgbDownsampled(page, sx, sy, outW, outH) {
        const r = new Uint8Array(outW * outH);
        const g = new Uint8Array(outW * outH);
        const b = new Uint8Array(outW * outH);

        const stripRows = Math.max(1, Math.min(page.rowsPerStrip || page.height, page.height));
        const bytesPerSample = Math.max(1, Math.ceil(page.bitsPerSample / 8));
        const bytesPerPixel = bytesPerSample * page.samplesPerPixel;
        const rowBytes = page.width * bytesPerPixel;

        let cachedStripIndex = -1;
        let cachedStripBuffer = null;
        let cachedStripView = null;
        let cachedRowsInStrip = 0;

        for (let dy = 0; dy < outH; dy++) {
            const srcY = Math.min(dy * sy, page.height - 1);
            const stripIndex = Math.floor(srcY / stripRows);

            if (stripIndex !== cachedStripIndex) {
                cachedStripIndex = stripIndex;
                cachedRowsInStrip = Math.min(stripRows, page.height - stripIndex * stripRows);
                cachedStripBuffer = await this.readStripBuffer(page, stripIndex, rowBytes, cachedRowsInStrip);
                cachedStripView = new DataView(cachedStripBuffer);
            }

            const rowInStrip = srcY - stripIndex * stripRows;
            const rowBase = rowInStrip * rowBytes;

            for (let dx = 0; dx < outW; dx++) {
                const srcX = Math.min(dx * sx, page.width - 1);
                const pixelBase = rowBase + srcX * bytesPerPixel;
                const outIdx = dx + dy * outW;

                if (page.samplesPerPixel === 1) {
                    const vRaw = this.readSample(cachedStripView, pixelBase, page.bitsPerSample);
                    const v = page.bitsPerSample === 16 ? (vRaw >> 8) : vRaw;
                    r[outIdx] = v;
                    g[outIdx] = v;
                    b[outIdx] = v;
                } else {
                    const rr = this.readSample(cachedStripView, pixelBase, page.bitsPerSample);
                    const gg = this.readSample(cachedStripView, pixelBase + bytesPerSample, page.bitsPerSample);
                    const bb = this.readSample(cachedStripView, pixelBase + bytesPerSample * 2, page.bitsPerSample);

                    r[outIdx] = page.bitsPerSample === 16 ? (rr >> 8) : rr;
                    g[outIdx] = page.bitsPerSample === 16 ? (gg >> 8) : gg;
                    b[outIdx] = page.bitsPerSample === 16 ? (bb >> 8) : bb;
                }
            }
        }

        return { r, g, b };
    }

    async parseIfd(ifdOffset) {
        const countBuf = await this.readBytes(ifdOffset, 2);
        const countView = new DataView(countBuf);
        const entryCount = countView.getUint16(0, this.littleEndian);

        const tableLength = entryCount * 12 + 4;
        const tableBuf = await this.readBytes(ifdOffset + 2, tableLength);
        const tableView = new DataView(tableBuf);
        const tableBytes = new Uint8Array(tableBuf);
        const entries = new Map();

        for (let i = 0; i < entryCount; i++) {
            const base = i * 12;
            const tag = tableView.getUint16(base, this.littleEndian);
            const type = tableView.getUint16(base + 2, this.littleEndian);
            const count = tableView.getUint32(base + 4, this.littleEndian);
            const valueBytes = tableBytes.slice(base + 8, base + 12);
            entries.set(tag, { tag, type, count, valueBytes });
        }

        const nextIfdOffset = tableView.getUint32(entryCount * 12, this.littleEndian);

        const width = await this.readScalar(entries, 256, 0);
        const height = await this.readScalar(entries, 257, 0);
        const bitsValues = await this.readValues(entries, 258);
        const compression = await this.readScalar(entries, 259, 1);
        const photometric = await this.readScalar(entries, 262, 1);
        const stripOffsets = await this.readValues(entries, 273) || [];
        const samplesPerPixel = await this.readScalar(entries, 277, 1);
        let rowsPerStrip = await this.readScalar(entries, 278, height || 1);
        const stripByteCounts = await this.readValues(entries, 279);
        const planarConfig = await this.readScalar(entries, 284, 1);
        const tileWidth = await this.readScalar(entries, 322, null);
        const tileLength = await this.readScalar(entries, 323, null);

        if (rowsPerStrip === 0 || rowsPerStrip === 0xffffffff) {
            rowsPerStrip = height || 1;
        }

        const bitsPerSample = bitsValues && bitsValues.length > 0 ? bitsValues[0] : 8;
        const bytesPerSample = Math.max(1, Math.ceil(bitsPerSample / 8));
        const rowBytes = (width || 0) * (samplesPerPixel || 1) * bytesPerSample;
        const stripsExpected = Math.max(1, Math.ceil((height || 1) / Math.max(1, rowsPerStrip)));

        const normalizedStripOffsets = Array.isArray(stripOffsets)
            ? stripOffsets.slice(0, stripsExpected)
            : [];

        const normalizedStripByteCounts = [];
        for (let s = 0; s < normalizedStripOffsets.length; s++) {
            const rowsInStrip = Math.min(rowsPerStrip, (height || 1) - s * rowsPerStrip);
            const fallback = Math.max(0, rowsInStrip * rowBytes);
            const source = Array.isArray(stripByteCounts) && s < stripByteCounts.length
                ? stripByteCounts[s]
                : fallback;
            normalizedStripByteCounts.push(source || fallback);
        }

        return {
            nextIfdOffset,
            page: {
                width,
                height,
                bitsPerSample,
                compression,
                photometric,
                samplesPerPixel,
                rowsPerStrip,
                planarConfig,
                stripOffsets: normalizedStripOffsets,
                stripByteCounts: normalizedStripByteCounts,
                tileWidth,
                tileLength
            }
        };
    }

    async readStripBuffer(page, stripIndex, rowBytes, rowsInStrip) {
        if (!Array.isArray(page.stripOffsets) || stripIndex < 0 || stripIndex >= page.stripOffsets.length) {
            throw new Error(`Strip index ${stripIndex} out of bounds`);
        }

        const offset = page.stripOffsets[stripIndex];
        let byteCount = Array.isArray(page.stripByteCounts) && stripIndex < page.stripByteCounts.length
            ? page.stripByteCounts[stripIndex]
            : 0;
        if (!byteCount || byteCount <= 0) {
            byteCount = rowsInStrip * rowBytes;
        }
        return this.readBytes(offset, byteCount);
    }

    readSample(view, byteOffset, bitsPerSample) {
        if (bitsPerSample === 8) {
            if (byteOffset + 1 > view.byteLength) return 0;
            return view.getUint8(byteOffset);
        }
        if (bitsPerSample === 16) {
            if (byteOffset + 2 > view.byteLength) return 0;
            return view.getUint16(byteOffset, this.littleEndian);
        }
        return 0;
    }

    async readScalar(entries, tag, defaultValue) {
        const values = await this.readValues(entries, tag);
        if (!values || values.length === 0) return defaultValue;
        return values[0];
    }

    async readValues(entries, tag) {
        const entry = entries.get(tag);
        if (!entry) return null;

        const typeSize = this.getTypeSize(entry.type);
        if (!typeSize) return null;
        const totalBytes = typeSize * entry.count;
        let raw = null;

        if (totalBytes <= 4) {
            raw = entry.valueBytes.slice(0, totalBytes);
        } else {
            const view = new DataView(entry.valueBytes.buffer, entry.valueBytes.byteOffset, 4);
            const valueOffset = view.getUint32(0, this.littleEndian);
            raw = new Uint8Array(await this.readBytes(valueOffset, totalBytes));
        }

        return this.parseTypedValues(raw, entry.type, entry.count);
    }

    parseTypedValues(rawBytes, type, count) {
        const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        const out = [];

        switch (type) {
            case 1: // BYTE
            case 2: // ASCII
            case 6: // SBYTE
            case 7: // UNDEFINED
                for (let i = 0; i < count; i++) {
                    out.push(view.getUint8(i));
                }
                return out;

            case 3: // SHORT
                for (let i = 0; i < count; i++) {
                    out.push(view.getUint16(i * 2, this.littleEndian));
                }
                return out;

            case 4: // LONG
                for (let i = 0; i < count; i++) {
                    out.push(view.getUint32(i * 4, this.littleEndian));
                }
                return out;

            case 8: // SSHORT
                for (let i = 0; i < count; i++) {
                    out.push(view.getInt16(i * 2, this.littleEndian));
                }
                return out;

            case 9: // SLONG
                for (let i = 0; i < count; i++) {
                    out.push(view.getInt32(i * 4, this.littleEndian));
                }
                return out;

            default:
                return null;
        }
    }

    getTypeSize(type) {
        switch (type) {
            case 1:
            case 2:
            case 6:
            case 7:
                return 1;
            case 3:
            case 8:
                return 2;
            case 4:
            case 9:
                return 4;
            case 5:
            case 10:
            case 12:
                return 8;
            default:
                return 0;
        }
    }

    async readBytes(offset, length) {
        const safeOffset = Math.max(0, Math.floor(offset));
        const safeLength = Math.max(0, Math.floor(length));
        const end = Math.min(this.file.size, safeOffset + safeLength);
        if (end <= safeOffset) {
            return new ArrayBuffer(0);
        }
        return this.file.slice(safeOffset, end).arrayBuffer();
    }
}

window.TiffStreamReader = TiffStreamReader;
