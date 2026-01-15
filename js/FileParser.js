class FileParser {
    constructor() {
        this.supportedImageFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        this.supportedMedicalFormats = ['tiff', 'tif', 'raw'];
    }

    /**
     * Group files by base name and type
     * Pairs .raw files with their .json or .volumeinfo metadata files
     * @param {FileList|Array} files
     * @returns {Array} Array of file groups
     */
    groupFiles(files) {
        const fileArray = Array.from(files);
        const groups = [];
        const fileMap = new Map();
        const processedFiles = new Set();

        // First pass: group RAW, JSON, and volumeinfo files
        fileArray.forEach(file => {
            const ext = this.getFileExtension(file.name).toLowerCase();

            if (ext === 'raw') {
                const basename = file.name.replace(/\.raw$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).raw = file;
                processedFiles.add(file);
            } else if (ext === 'json') {
                const basename = file.name.replace(/\.json$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).json = file;
                processedFiles.add(file);
            } else if (ext === 'volumeinfo') {
                // volumeinfo files are named like "name.raw.volumeinfo"
                const basename = file.name.replace(/\.raw\.volumeinfo$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).volumeinfo = file;
                processedFiles.add(file);
            }
        });

        // Create groups for RAW+metadata pairs (JSON takes priority over volumeinfo)
        fileMap.forEach((fileGroup, basename) => {
            if (fileGroup.raw && (fileGroup.json || fileGroup.volumeinfo)) {
                groups.push({
                    type: '3d-raw',
                    rawFile: fileGroup.raw,
                    jsonFile: fileGroup.json || null,
                    volumeinfoFile: fileGroup.volumeinfo || null,
                    name: basename
                });
            } else if (fileGroup.raw) {
                console.warn(`RAW file ${basename}.raw found without matching metadata file`);
            } else if (fileGroup.json) {
                console.warn(`JSON file ${basename}.json found without matching RAW file`);
            } else if (fileGroup.volumeinfo) {
                console.warn(`Volumeinfo file ${basename}.raw.volumeinfo found without matching RAW file`);
            }
        });

        // Second pass: process remaining files
        fileArray.forEach(file => {
            if (processedFiles.has(file)) return;

            const ext = this.getFileExtension(file.name).toLowerCase();

            if (ext === 'tiff' || ext === 'tif') {
                groups.push({
                    type: 'tiff',
                    file: file,
                    name: file.name
                });
            } else if (this.supportedImageFormats.includes(ext)) {
                groups.push({
                    type: '2d-image',
                    file: file,
                    name: file.name
                });
            }
        });

        return groups;
    }

    /**
     * Get file extension
     */
    getFileExtension(filename) {
        const parts = filename.split('.');
        return parts.length > 1 ? parts[parts.length - 1] : '';
    }

    /**
     * Load and parse JSON metadata file
     * @param {File} file
     * @returns {Promise<object>}
     */
    async loadJSONMetadata(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const metadata = JSON.parse(e.target.result);
                    this.validateMetadata(metadata);
                    resolve(metadata);
                } catch (error) {
                    reject(new Error(`Failed to parse JSON metadata: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read JSON file'));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Load and parse volumeinfo metadata file (CERA INI format)
     * @param {File} file
     * @returns {Promise<object>}
     */
    async loadVolumeinfoMetadata(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const metadata = this.parseVolumeinfo(e.target.result);
                    this.validateMetadata(metadata);
                    resolve(metadata);
                } catch (error) {
                    reject(new Error(`Failed to parse volumeinfo metadata: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read volumeinfo file'));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Parse CERA volumeinfo INI format into standard metadata object
     * @param {string} content - File content
     * @returns {object} Metadata object compatible with VolumeData
     */
    parseVolumeinfo(content) {
        const lines = content.split('\n');
        const volumeSection = {};
        let inVolumeSection = false;

        // Parse only the [Volume] section
        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '[Volume]') {
                inVolumeSection = true;
                continue;
            }

            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                // New section started, stop if we were in Volume section
                if (inVolumeSection) break;
                continue;
            }

            if (inVolumeSection && trimmed.includes('=')) {
                const [key, ...valueParts] = trimmed.split('=');
                volumeSection[key.trim()] = valueParts.join('=').trim();
            }
        }

        // Extract and convert to standard format
        const sizeX = parseInt(volumeSection.SizeX);
        const sizeY = parseInt(volumeSection.SizeY);
        const sizeZ = parseInt(volumeSection.SizeZ);

        if (isNaN(sizeX) || isNaN(sizeY) || isNaN(sizeZ)) {
            throw new Error('Missing or invalid SizeX/SizeY/SizeZ in volumeinfo');
        }

        const metadata = {
            dimensions: [sizeX, sizeY, sizeZ],
            dataType: volumeSection.Datatype || 'uint16',
            byteOrder: 'little-endian',
            spacing: [
                parseFloat(volumeSection.VoxelSizeX) || 1.0,
                parseFloat(volumeSection.VoxelSizeY) || 1.0,
                parseFloat(volumeSection.VoxelSizeZ) || 1.0
            ]
        };

        // Include additional volumeinfo fields if present
        if (volumeSection.Min !== undefined) {
            metadata.min = parseFloat(volumeSection.Min);
        }
        if (volumeSection.Max !== undefined) {
            metadata.max = parseFloat(volumeSection.Max);
        }
        if (volumeSection.Description) {
            metadata.description = volumeSection.Description;
        }

        return metadata;
    }

    /**
     * Validate JSON metadata
     */
    validateMetadata(metadata) {
        if (!metadata.dimensions || !Array.isArray(metadata.dimensions) || metadata.dimensions.length !== 3) {
            throw new Error('Metadata must contain "dimensions" array with 3 elements [x, y, z]');
        }

        if (!metadata.dataType) {
            throw new Error('Metadata must contain "dataType" field');
        }

        const validTypes = ['uint8', 'uint16', 'float32'];
        if (!validTypes.includes(metadata.dataType.toLowerCase())) {
            throw new Error(`Invalid dataType "${metadata.dataType}". Must be one of: ${validTypes.join(', ')}`);
        }

        // Check for negative dimensions
        if (metadata.dimensions.some(d => d <= 0)) {
            throw new Error('All dimensions must be positive values');
        }
    }

    /**
     * Load RAW binary file
     * @param {File} file
     * @returns {Promise<ArrayBuffer>}
     */
    async loadRAWFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                resolve(e.target.result);
            };

            reader.onerror = () => {
                reject(new Error('Failed to read RAW file'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Load and parse a 3D volume (RAW + JSON or volumeinfo)
     * @param {File} rawFile
     * @param {File} jsonFile - JSON metadata file (optional if volumeinfoFile provided)
     * @param {Function} progressCallback - Optional callback for progress updates
     * @param {File} volumeinfoFile - Volumeinfo metadata file (optional if jsonFile provided)
     * @returns {Promise<VolumeData>}
     */
    async load3DVolume(rawFile, jsonFile, progressCallback, volumeinfoFile) {
        try {
            // Load metadata first (JSON takes priority over volumeinfo)
            if (progressCallback) progressCallback({ stage: 'metadata', progress: 0 });

            let metadata;
            if (jsonFile) {
                metadata = await this.loadJSONMetadata(jsonFile);
            } else if (volumeinfoFile) {
                metadata = await this.loadVolumeinfoMetadata(volumeinfoFile);
            } else {
                throw new Error('No metadata file provided (JSON or volumeinfo)');
            }

            // Load RAW data
            if (progressCallback) progressCallback({ stage: 'loading', progress: 0 });
            const arrayBuffer = await this.loadRAWFile(rawFile);

            // Create VolumeData instance
            if (progressCallback) progressCallback({ stage: 'parsing', progress: 50 });
            const volumeData = new VolumeData(arrayBuffer, metadata);

            if (progressCallback) progressCallback({ stage: 'complete', progress: 100 });
            return volumeData;

        } catch (error) {
            throw new Error(`Failed to load 3D volume: ${error.message}`);
        }
    }

    /**
     * Load TIFF file (placeholder - requires tiff.js library)
     * @param {File} file
     * @returns {Promise<object>}
     */
    async loadTIFF(file) {
        // Check if tiff.js is loaded
        if (typeof Tiff === 'undefined') {
            throw new Error('TIFF library not loaded. Please include tiff.js');
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const tiff = new Tiff({ buffer: arrayBuffer });
                    const canvas = tiff.toCanvas();

                    // Get image data
                    const ctx = canvas.getContext('2d');
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                    // Check if multi-page TIFF
                    const pageCount = tiff.countDirectory();

                    // Extract TIFF metadata for bit depth detection
                    // TIFF tags: 258 = BitsPerSample, 277 = SamplesPerPixel, 262 = PhotometricInterpretation
                    const bitsPerSample = tiff.getField(258) || 8;
                    const samplesPerPixel = tiff.getField(277) || 1;
                    const photometric = tiff.getField(262); // 0=WhiteIsZero, 1=BlackIsZero, 2=RGB

                    // Determine if grayscale uint16
                    const isGrayscale = samplesPerPixel === 1 && (photometric === 0 || photometric === 1);
                    const isUint16 = bitsPerSample === 16;

                    resolve({
                        type: pageCount > 1 ? '3d-tiff' : '2d-tiff',
                        width: canvas.width,
                        height: canvas.height,
                        pageCount: pageCount,
                        imageData: imageData,
                        tiff: tiff,
                        // Raw data info for uint16 grayscale support
                        rawBuffer: arrayBuffer,
                        bitsPerSample: bitsPerSample,
                        samplesPerPixel: samplesPerPixel,
                        isGrayscale: isGrayscale,
                        isUint16: isUint16
                    });

                } catch (error) {
                    reject(new Error(`Failed to parse TIFF: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read TIFF file'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Convert a 2D image file to VolumeData
     * Grayscale images become depth-1 volumes
     * RGB images become depth-3 volumes (R, G, B as separate z-slices)
     * @param {File} file - Image file (PNG, JPG, etc.)
     * @returns {Promise<VolumeData>}
     */
    async convertImageToVolume(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    // Create off-screen canvas
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    // Extract pixel data
                    const imageData = ctx.getImageData(0, 0, img.width, img.height);
                    const pixels = imageData.data; // RGBA format

                    // Detect if grayscale (R === G === B for all pixels)
                    let isGrayscale = true;
                    for (let i = 0; i < pixels.length; i += 4) {
                        if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) {
                            isGrayscale = false;
                            break;
                        }
                    }

                    const width = img.width;
                    const height = img.height;
                    let arrayBuffer, metadata;

                    if (isGrayscale) {
                        // Depth-1 volume: just copy one channel
                        const data = new Uint8Array(width * height);
                        for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
                            data[j] = pixels[i]; // R channel (same as G and B)
                        }
                        arrayBuffer = data.buffer;
                        metadata = {
                            dimensions: [width, height, 1],
                            dataType: 'uint8',
                            spacing: [1.0, 1.0, 1.0],
                            isRGB: false
                        };
                    } else {
                        // Depth-3 volume: R, G, B as separate z-slices
                        const data = new Uint8Array(width * height * 3);
                        const sliceSize = width * height;

                        for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
                            data[j] = pixels[i];                     // R at z=0
                            data[j + sliceSize] = pixels[i + 1];     // G at z=1
                            data[j + sliceSize * 2] = pixels[i + 2]; // B at z=2
                        }
                        arrayBuffer = data.buffer;
                        metadata = {
                            dimensions: [width, height, 3],
                            dataType: 'uint8',
                            spacing: [1.0, 1.0, 1.0],
                            isRGB: true
                        };
                    }

                    URL.revokeObjectURL(img.src);
                    resolve(new VolumeData(arrayBuffer, metadata));
                } catch (error) {
                    URL.revokeObjectURL(img.src);
                    reject(new Error(`Failed to convert image to volume: ${error.message}`));
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Failed to load image'));
            };

            img.src = URL.createObjectURL(file);
        });
    }

    /**
     * Convert TIFF data to VolumeData
     * @param {object} tiffData - Result from loadTIFF()
     * @returns {VolumeData}
     */
    convertTiffToVolume(tiffData) {
        const { width, height, isGrayscale, isUint16, rawBuffer, tiff } = tiffData;

        let arrayBuffer, metadata;

        if (isGrayscale && isUint16) {
            // Extract raw uint16 values from TIFF
            const data = this.extractUint16FromTiff(tiff, width, height, rawBuffer);
            arrayBuffer = data.buffer;
            metadata = {
                dimensions: [width, height, 1],
                dataType: 'uint16',
                spacing: [1.0, 1.0, 1.0],
                isRGB: false
            };
        } else if (isGrayscale) {
            // 8-bit grayscale
            const canvas = tiff.toCanvas();
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;

            const data = new Uint8Array(width * height);
            for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
                data[j] = pixels[i];
            }
            arrayBuffer = data.buffer;
            metadata = {
                dimensions: [width, height, 1],
                dataType: 'uint8',
                spacing: [1.0, 1.0, 1.0],
                isRGB: false
            };
        } else {
            // RGB TIFF - treat as 3-channel volume
            const canvas = tiff.toCanvas();
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;

            const data = new Uint8Array(width * height * 3);
            const sliceSize = width * height;

            for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
                data[j] = pixels[i];
                data[j + sliceSize] = pixels[i + 1];
                data[j + sliceSize * 2] = pixels[i + 2];
            }
            arrayBuffer = data.buffer;
            metadata = {
                dimensions: [width, height, 3],
                dataType: 'uint8',
                spacing: [1.0, 1.0, 1.0],
                isRGB: true
            };
        }

        return new VolumeData(arrayBuffer, metadata);
    }

    /**
     * Extract uint16 values from TIFF raw buffer
     */
    extractUint16FromTiff(tiff, width, height, rawBuffer) {
        const data = new Uint16Array(width * height);
        const dataView = new DataView(rawBuffer);
        const expectedDataSize = width * height * 2;

        // Try to get strip offsets from TIFF tags
        const stripOffsets = tiff.getField(273); // StripOffsets tag
        const stripByteCounts = tiff.getField(279); // StripByteCounts tag

        // Detect endianness from TIFF header
        const byteOrder = dataView.getUint16(0, false);
        const littleEndian = (byteOrder === 0x4949); // 'II' = little endian

        // Calculate fallback offset (assume data at end of file)
        let fallbackOffset = rawBuffer.byteLength - expectedDataSize;
        if (fallbackOffset < 8) fallbackOffset = 8; // Minimum TIFF header size

        try {
            if (Array.isArray(stripOffsets) && stripOffsets.length > 0) {
                // Multi-strip TIFF
                let pixelIndex = 0;
                for (let s = 0; s < stripOffsets.length; s++) {
                    const offset = stripOffsets[s];
                    const byteCount = stripByteCounts ? stripByteCounts[s] : (expectedDataSize / stripOffsets.length);
                    const pixelCount = byteCount / 2;

                    // Bounds check
                    if (offset + byteCount > rawBuffer.byteLength) {
                        throw new Error('Strip offset out of bounds');
                    }

                    for (let i = 0; i < pixelCount && pixelIndex < data.length; i++, pixelIndex++) {
                        data[pixelIndex] = dataView.getUint16(offset + i * 2, littleEndian);
                    }
                }
            } else if (stripOffsets && stripOffsets + expectedDataSize <= rawBuffer.byteLength) {
                // Single-strip TIFF with valid offset
                const offset = stripOffsets;
                for (let i = 0; i < data.length; i++) {
                    data[i] = dataView.getUint16(offset + i * 2, littleEndian);
                }
            } else {
                // Fallback: assume data is at end of buffer
                console.log(`Using fallback offset: ${fallbackOffset}`);
                for (let i = 0; i < data.length; i++) {
                    data[i] = dataView.getUint16(fallbackOffset + i * 2, littleEndian);
                }
            }
        } catch (e) {
            // Fallback on any error
            console.warn('TIFF strip extraction failed, using fallback:', e.message);
            for (let i = 0; i < data.length; i++) {
                const byteOffset = fallbackOffset + i * 2;
                if (byteOffset + 2 <= rawBuffer.byteLength) {
                    data[i] = dataView.getUint16(byteOffset, littleEndian);
                }
            }
        }

        return data;
    }

    /**
     * Detect file type
     * @param {File} file
     * @returns {string} File type ('2d-image', 'tiff', 'raw', 'json', 'unknown')
     */
    detectFileType(file) {
        const ext = this.getFileExtension(file.name).toLowerCase();

        if (ext === 'raw') return 'raw';
        if (ext === 'json') return 'json';
        if (ext === 'tiff' || ext === 'tif') return 'tiff';
        if (this.supportedImageFormats.includes(ext)) return '2d-image';

        return 'unknown';
    }

    /**
     * Get file info
     */
    getFileInfo(file) {
        return {
            name: file.name,
            type: this.detectFileType(file),
            size: file.size,
            sizeMB: (file.size / (1024 * 1024)).toFixed(2),
            lastModified: new Date(file.lastModified).toLocaleString()
        };
    }
}
