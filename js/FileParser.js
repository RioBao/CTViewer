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
     * Load standard 2D image
     * @param {File} file
     * @returns {Promise<string>} Blob URL
     */
    async load2DImage(file) {
        return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) {
                reject(new Error('File is not a valid image'));
                return;
            }

            const url = URL.createObjectURL(file);
            resolve(url);
        });
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
