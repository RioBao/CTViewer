class FileParser {
    constructor() {
        const config = (typeof ViewerConfig !== 'undefined' && ViewerConfig.formats)
            ? ViewerConfig.formats
            : null;
        this.formats = config || {
            image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
            tiff: ['tif', 'tiff'],
            raw: ['raw'],
            rawMetadata: ['json', 'volumeinfo', 'dat'],
            dicom: ['dcm'],
            nifti: ['nii', 'nii.gz']
        };
        this.supportedImageFormats = this.formats.image;
        this.dicomLoader = new DicomLoader();
        this.niftiLoader = new NiftiLoader();
    }

    /**
     * Group files by type (async to allow DICOM detection)
     * @param {FileList|Array} files
     * @returns {Promise<Array>} Array of file groups
     */
    async groupFilesAsync(files) {
        const fileArray = Array.from(files);
        const niftiGroups = [];
        const dicomCandidates = [];
        const remaining = [];

        for (const file of fileArray) {
            const lower = file.name.toLowerCase();
            const ext = this.getFileExtension(file.name).toLowerCase();

            if (this.isNiftiFileName(lower)) {
                niftiGroups.push({
                    type: 'nifti',
                    file: file,
                    name: file.name
                });
                continue;
            }

            if (ext === 'dcm') {
                dicomCandidates.push(file);
                continue;
            }

            if (this.isKnownNonDicom(ext)) {
                remaining.push(file);
                continue;
            }

            dicomCandidates.push(file);
        }

        const dicomFiles = [];
        const notDicom = [];

        for (const file of dicomCandidates) {
            try {
                if (await this.dicomLoader.isDicomFile(file)) {
                    dicomFiles.push(file);
                } else {
                    notDicom.push(file);
                }
            } catch (e) {
                notDicom.push(file);
            }
        }

        const groups = this.groupFiles(remaining.concat(notDicom));

        if (niftiGroups.length > 0) {
            groups.push(...niftiGroups);
        }

        if (dicomFiles.length > 0) {
            const dicomGroups = await this.dicomLoader.scanSeries(dicomFiles);
            groups.push(...dicomGroups);
        }

        return groups;
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

        // First pass: group RAW, JSON, volumeinfo, and DAT files
        fileArray.forEach(file => {
            const ext = this.getFileExtension(file.name).toLowerCase();

            if (this.isRawExt(ext)) {
                const basename = file.name.replace(/\.raw$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).raw = file;
                processedFiles.add(file);
            } else if (ext === 'json') {
                const basename = file.name
                    .replace(/\.raw\.json$/i, '')
                    .replace(/\.json$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).json = file;
                processedFiles.add(file);
            } else if (ext === 'volumeinfo') {
                // volumeinfo files are usually "name.raw.volumeinfo" but also support "name.volumeinfo"
                const basename = file.name
                    .replace(/\.raw\.volumeinfo$/i, '')
                    .replace(/\.volumeinfo$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).volumeinfo = file;
                processedFiles.add(file);
            } else if (ext === 'dat') {
                const basename = file.name
                    .replace(/\.raw\.dat$/i, '')
                    .replace(/\.dat$/i, '');
                if (!fileMap.has(basename)) {
                    fileMap.set(basename, {});
                }
                fileMap.get(basename).dat = file;
                processedFiles.add(file);
            }
        });

        // Create groups for RAW+metadata pairs (JSON takes priority over volumeinfo, then DAT)
        const unmatchedRaw = [];
        const unmatchedMetadata = [];

        fileMap.forEach((fileGroup, basename) => {
            if (fileGroup.raw && (fileGroup.json || fileGroup.volumeinfo || fileGroup.dat)) {
                groups.push({
                    type: '3d-raw',
                    rawFile: fileGroup.raw,
                    jsonFile: fileGroup.json || null,
                    volumeinfoFile: fileGroup.volumeinfo || null,
                    datFile: fileGroup.dat || null,
                    name: basename
                });
            } else {
                if (fileGroup.raw) {
                    unmatchedRaw.push({ basename, fileGroup });
                }
                if (fileGroup.json || fileGroup.volumeinfo || fileGroup.dat) {
                    unmatchedMetadata.push({ basename, fileGroup });
                }
            }
        });

        // Robust fallback: if user selected exactly one RAW and one metadata file, pair them explicitly.
        if (groups.length === 0 && unmatchedRaw.length === 1 && unmatchedMetadata.length === 1) {
            const rawEntry = unmatchedRaw[0];
            const metaEntry = unmatchedMetadata[0];
            const fallbackName = rawEntry.basename || rawEntry.fileGroup.raw.name.replace(/\.raw$/i, '');
            groups.push({
                type: '3d-raw',
                rawFile: rawEntry.fileGroup.raw,
                jsonFile: metaEntry.fileGroup.json || null,
                volumeinfoFile: metaEntry.fileGroup.volumeinfo || null,
                datFile: metaEntry.fileGroup.dat || null,
                name: fallbackName
            });
        } else {
            // Keep diagnostics for truly unpaired selections.
            unmatchedRaw.forEach(({ basename }) => {
                console.warn(`RAW file ${basename}.raw found without matching metadata file`);
            });
            unmatchedMetadata.forEach(({ basename, fileGroup }) => {
                if (fileGroup.json) {
                    console.warn(`JSON file ${basename}.json found without matching RAW file`);
                }
                if (fileGroup.volumeinfo) {
                    console.warn(`Volumeinfo file ${basename}.raw.volumeinfo found without matching RAW file`);
                }
                if (fileGroup.dat) {
                    console.warn(`DAT file ${basename}.dat found without matching RAW file`);
                }
            });
        }

        // Second pass: process remaining files
        const tiffFiles = [];
        fileArray.forEach(file => {
            if (processedFiles.has(file)) return;

            const ext = this.getFileExtension(file.name).toLowerCase();

            if (this.isTiffExt(ext)) {
                tiffFiles.push(file);
            } else if (this.supportedImageFormats.includes(ext)) {
                groups.push({
                    type: '2d-image',
                    file: file,
                    name: file.name
                });
            }
        });

        if (tiffFiles.length > 0) {
            const sortedTiffFiles = tiffFiles
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

            groups.push({
                type: 'tiff',
                file: sortedTiffFiles[0],
                files: sortedTiffFiles,
                name: sortedTiffFiles.length === 1
                    ? sortedTiffFiles[0].name
                    : `TIFF Stack (${sortedTiffFiles.length} files)`
            });
        }

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
     * Check if filename is NIfTI (.nii or .nii.gz)
     */
    isNiftiFileName(filename) {
        const lower = filename.toLowerCase();
        return lower.endsWith('.nii') || lower.endsWith('.nii.gz');
    }

    /**
     * Determine if extension is a known non-DICOM type
     */
    isKnownNonDicom(ext) {
        if (this.isRawExt(ext) || this.isRawMetadataExt(ext)) return true;
        if (this.isTiffExt(ext)) return true;
        if (this.supportedImageFormats.includes(ext)) return true;
        if (ext === 'nii' || ext === 'gz') return true;
        return false;
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
     * Load and parse .dat metadata file (Voreen-style)
     * @param {File} file
     * @returns {Promise<object>}
     */
    async loadDatMetadata(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const metadata = this.parseDat(e.target.result);
                    this.validateMetadata(metadata);
                    resolve(metadata);
                } catch (error) {
                    reject(new Error(`Failed to parse DAT metadata: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read DAT file'));
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
     * Parse Voreen-style .dat metadata format into standard metadata object
     * @param {string} content
     * @returns {object}
     */
    parseDat(content) {
        const lines = content.split('\n');
        const map = {};

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf(':');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim().toLowerCase();
            const value = trimmed.slice(idx + 1).trim();
            map[key] = value;
        }

        const resolution = (map.resolution || '').split(/\s+/).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v));
        if (resolution.length !== 3) {
            throw new Error('Missing or invalid Resolution in DAT file');
        }

        const spacingVals = (map.slicethickness || map.spacing || '').split(/\s+/).map(v => parseFloat(v)).filter(v => Number.isFinite(v));
        const spacing = [
            spacingVals[0] || 1.0,
            spacingVals[1] || 1.0,
            spacingVals[2] || 1.0
        ];

        const format = (map.format || '').trim().toUpperCase();
        let dataType;
        switch (format) {
            case 'UCHAR':
            case 'UINT8':
            case 'BYTE':
                dataType = 'uint8';
                break;
            case 'USHORT':
            case 'UINT16':
                dataType = 'uint16';
                break;
            case 'FLOAT':
            case 'FLOAT32':
                dataType = 'float32';
                break;
            default:
                throw new Error(`Unsupported DAT format: ${format || 'unknown'}`);
        }

        const metadata = {
            dimensions: resolution,
            dataType: dataType,
            spacing: spacing
        };

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

        // Normalize dataType aliases
        const dataTypeLower = metadata.dataType.toLowerCase();
        if (dataTypeLower === 'float') {
            metadata.dataType = 'float32';
        }

        const validTypes = ['uint8', 'uint16', 'float32'];
        if (!validTypes.includes(metadata.dataType.toLowerCase())) {
            throw new Error(`Invalid dataType "${metadata.dataType}". Must be one of: ${validTypes.join(', ')}, float`);
        }

        // Check for negative dimensions
        if (metadata.dimensions.some(d => d <= 0)) {
            throw new Error('All dimensions must be positive values');
        }
    }

    /**
     * Load RAW binary file
     * Uses chunked reading for large files to avoid browser memory issues
     * @param {File} file
     * @returns {Promise<ArrayBuffer>}
     */
    async loadRAWFile(file) {
        const fileSizeGB = file.size / (1024 * 1024 * 1024);
        console.log(`Loading RAW file: ${file.name}, size: ${fileSizeGB.toFixed(2)} GB`);

        // Use chunked reading for files larger than 500MB
        const CHUNK_THRESHOLD = 500 * 1024 * 1024;

        if (file.size > CHUNK_THRESHOLD) {
            return this.loadRAWFileChunked(file);
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                console.log(`RAW file loaded successfully, buffer size: ${e.target.result.byteLength}`);
                resolve(e.target.result);
            };

            reader.onerror = (e) => {
                const error = reader.error;
                console.error('FileReader error:', error);
                reject(new Error(`Failed to read RAW file: ${error ? error.message : 'Unknown error'}`));
            };

            reader.onabort = () => {
                reject(new Error('RAW file reading was aborted'));
            };

            try {
                reader.readAsArrayBuffer(file);
            } catch (e) {
                reject(new Error(`Failed to start reading RAW file: ${e.message}`));
            }
        });
    }

    /**
     * Load RAW file in chunks for large files
     * @param {File} file
     * @returns {Promise<ArrayBuffer>}
     */
    async loadRAWFileChunked(file) {
        const CHUNK_SIZE = 256 * 1024 * 1024; // 256MB chunks
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        console.log(`Reading file in ${totalChunks} chunks of ${CHUNK_SIZE / (1024 * 1024)}MB`);

        // Pre-allocate the full buffer
        const fullBuffer = new ArrayBuffer(file.size);
        const fullView = new Uint8Array(fullBuffer);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            console.log(`Reading chunk ${i + 1}/${totalChunks} (${start} - ${end})`);

            const chunkBuffer = await this.readFileChunk(chunk);
            const chunkView = new Uint8Array(chunkBuffer);

            // Copy chunk into full buffer
            fullView.set(chunkView, start);

            // Allow UI to update
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        console.log(`RAW file loaded successfully (chunked), buffer size: ${fullBuffer.byteLength}`);
        return fullBuffer;
    }

    /**
     * Read a single file chunk
     * @param {Blob} chunk
     * @returns {Promise<ArrayBuffer>}
     */
    readFileChunk(chunk) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                resolve(e.target.result);
            };

            reader.onerror = (e) => {
                const error = reader.error;
                reject(new Error(`Failed to read chunk: ${error ? error.message : 'Unknown error'}`));
            };

            reader.readAsArrayBuffer(chunk);
        });
    }

    /**
     * Read a full file as ArrayBuffer with optional progress callback.
     * @param {File|Blob} file
     * @param {(fraction:number)=>void} onProgress
     * @returns {Promise<ArrayBuffer>}
     */
    readFileAsArrayBufferWithProgress(file, onProgress = null) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                if (onProgress) onProgress(1);
                resolve(e.target.result);
            };

            reader.onprogress = (e) => {
                if (!onProgress || !e.lengthComputable) return;
                const fraction = e.total > 0 ? (e.loaded / e.total) : 0;
                onProgress(Math.max(0, Math.min(1, fraction)));
            };

            reader.onerror = () => {
                const error = reader.error;
                reject(new Error(`Failed to read file: ${error ? error.message : 'Unknown error'}`));
            };

            reader.onabort = () => {
                reject(new Error('File read was aborted'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Load and parse a 3D volume (RAW + JSON, volumeinfo, or DAT)
     * @param {File} rawFile
     * @param {File} jsonFile - JSON metadata file (optional if other metadata provided)
     * @param {Function} progressCallback - Optional callback for progress updates
     * @param {File} volumeinfoFile - Volumeinfo metadata file (optional if jsonFile provided)
     * @param {File} datFile - DAT metadata file (optional if json/volumeinfo provided)
     * @returns {Promise<VolumeData>}
     */
    async load3DVolume(rawFile, jsonFile, progressCallback, volumeinfoFile, datFile) {
        try {
            // Load metadata first (JSON takes priority over volumeinfo)
            if (progressCallback) progressCallback({ stage: 'metadata', progress: 0 });

            let metadata;
            if (jsonFile) {
                metadata = await this.loadJSONMetadata(jsonFile);
            } else if (volumeinfoFile) {
                metadata = await this.loadVolumeinfoMetadata(volumeinfoFile);
            } else if (datFile) {
                metadata = await this.loadDatMetadata(datFile);
            } else {
                throw new Error('No metadata file provided (JSON, volumeinfo, or DAT)');
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
     * Load 3D volume progressively with Z-axis tiling
     * Shows low-res preview immediately, then loads blocks from center outward
     * For very large files (>1GB), uses streaming mode that never loads full data
     * @param {File} rawFile
     * @param {File} jsonFile - JSON metadata file (optional if other metadata provided)
     * @param {Object} callbacks - { onProgress, onLowResReady, onBlockReady, onAllBlocksReady }
     * @param {File} volumeinfoFile - Volumeinfo metadata file (optional if jsonFile provided)
     * @param {File} datFile - DAT metadata file (optional if json/volumeinfo provided)
     * @returns {Promise<ProgressiveVolumeData|StreamingVolumeData>}
     */
    async load3DVolumeProgressive(rawFile, jsonFile, callbacks, volumeinfoFile, datFile) {
        try {
            // Load metadata first (JSON takes priority over volumeinfo)
            if (callbacks.onProgress) callbacks.onProgress({ stage: 'metadata', progress: 0 });

            let metadata;
            if (jsonFile) {
                metadata = await this.loadJSONMetadata(jsonFile);
            } else if (volumeinfoFile) {
                metadata = await this.loadVolumeinfoMetadata(volumeinfoFile);
            } else if (datFile) {
                metadata = await this.loadDatMetadata(datFile);
            } else {
                throw new Error('No metadata file provided (JSON, volumeinfo, or DAT)');
            }

            const loader = new ProgressiveVolumeLoader();

            // Always pass file reference — loader decides strategy:
            // >2GB: streaming (never loads full data)
            // <=2GB: hybrid (quick low-res preview, then full data in background)
            if (callbacks.onProgress) callbacks.onProgress({ stage: 'streaming', progress: 0 });

            const progressiveData = await loader.loadProgressive(null, metadata, callbacks, rawFile);

            if (callbacks.onProgress) callbacks.onProgress({ stage: 'complete', progress: 100 });
            return progressiveData;

        } catch (error) {
            throw new Error(`Failed to load 3D volume progressively: ${error.message}`);
        }
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
     * Scan TIFF group metadata without materializing full page buffers.
     * @param {File[]|FileList} files
     * @param {Function} progressCallback
     * @returns {Promise<object>}
     */
    async scanTIFFGroupMetadata(files, progressCallback = null) {
        const list = Array.from(files || []);
        if (list.length === 0) {
            throw new Error('No TIFF files provided');
        }

        const sorted = list
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        if (typeof Tiff === 'undefined') {
            throw new Error('TIFF library not loaded. Please include tiff.js');
        }

        const pages = [];
        let width = null;
        let height = null;
        let totalPages = 0;
        let allUint16Gray = true;
        let hasColor = false;

        if (progressCallback) {
            progressCallback({ stage: 'metadata', progress: 0 });
        }

        for (let fileIndex = 0; fileIndex < sorted.length; fileIndex++) {
            const file = sorted[fileIndex];
            this.assertTiffFileSizeSupported(file);
            const arrayBuffer = await this.readFileAsArrayBufferWithProgress(
                file,
                (fraction) => {
                    if (progressCallback) {
                        progressCallback({
                            stage: 'metadata',
                            progress: Math.round(((fileIndex + fraction) / sorted.length) * 100)
                        });
                    }
                }
            );
            let tiff = null;
            try {
                tiff = new Tiff({ buffer: arrayBuffer });
            } catch (error) {
                throw this.wrapTiffLibraryError(file, error, 'scan TIFF metadata');
            }

            try {
                const pageCount = Math.max(1, tiff.countDirectory());
                for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
                    tiff.setDirectory(pageIndex);

                    const pageWidth = tiff.width();
                    const pageHeight = tiff.height();
                    const bitsPerSample = tiff.getField(258) || 8;
                    const samplesPerPixel = tiff.getField(277) || 1;
                    const photometric = tiff.getField(262);

                    const isGrayscale = samplesPerPixel === 1 && (photometric === 0 || photometric === 1);
                    const isUint16 = isGrayscale && bitsPerSample === 16;

                    if (width === null || height === null) {
                        width = pageWidth;
                        height = pageHeight;
                    } else if (pageWidth !== width || pageHeight !== height) {
                        throw new Error(
                            `TIFF page size mismatch in ${file.name}: expected ${width}x${height}, got ${pageWidth}x${pageHeight}`
                        );
                    }

                    if (!isGrayscale) {
                        hasColor = true;
                    }
                    if (!isUint16) {
                        allUint16Gray = false;
                    }

                    pages.push({
                        fileIndex,
                        pageIndex,
                        isGrayscale,
                        isUint16
                    });
                    totalPages++;
                }
            } finally {
                if (tiff && typeof tiff.close === 'function') {
                    tiff.close();
                }
            }

            if (progressCallback) {
                progressCallback({
                    stage: 'metadata',
                    progress: Math.round(((fileIndex + 1) / sorted.length) * 100)
                });
            }
        }

        if (totalPages === 0 || width === null || height === null) {
            throw new Error('No TIFF pages found');
        }

        return {
            files: sorted,
            pages,
            width,
            height,
            totalPages,
            allUint16Gray,
            hasColor
        };
    }

    /**
     * Load TIFF stack directly into an adaptively downsampled VolumeData to reduce peak memory.
     * @param {File[]|FileList} files
     * @param {object} options
     * @param {Function} progressCallback
     * @returns {Promise<{volumeData: VolumeData, downsample: object}>}
     */
    async loadTIFFGroupAsVolume(files, options = {}, progressCallback = null) {
        const targetBytes = Number.isFinite(options.targetBytes) && options.targetBytes > 0
            ? options.targetBytes
            : 512 * 1024 * 1024;

        const list = Array.from(files || []);
        if (list.length === 0) {
            throw new Error('No TIFF files provided');
        }

        const sorted = list
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        if (sorted.length === 1) {
            return this.loadSingleTIFFFileAsVolume(sorted[0], targetBytes, progressCallback);
        }

        const meta = await this.scanTIFFGroupMetadata(files, progressCallback);
        const mode = (meta.totalPages === 1 && meta.hasColor)
            ? 'rgb-single'
            : (meta.allUint16Gray ? 'uint16-stack' : 'uint8-stack');

        const bytesPerVoxel = mode === 'uint16-stack' ? 2 : 1;
        const fullDepth = mode === 'rgb-single' ? 3 : meta.totalPages;
        const fullBytes = meta.width * meta.height * fullDepth * bytesPerVoxel;

        const scales = this.computeAdaptiveTiffScale(
            meta.width,
            meta.height,
            meta.totalPages,
            mode,
            bytesPerVoxel,
            targetBytes
        );
        const [sx, sy, sz] = scales;

        const dstNx = Math.max(1, Math.ceil(meta.width / sx));
        const dstNy = Math.max(1, Math.ceil(meta.height / sy));
        const dstNz = mode === 'rgb-single'
            ? 3
            : Math.max(1, Math.ceil(meta.totalPages / sz));

        const TypedArrayCtor = mode === 'uint16-stack' ? Uint16Array : Uint8Array;
        const dst = new TypedArrayCtor(dstNx * dstNy * dstNz);
        const dstSliceSize = dstNx * dstNy;

        if (progressCallback) {
            progressCallback({ stage: 'processing', progress: 0 });
        }

        let globalPage = 0;
        let writtenSlices = 0;

        for (let fileIndex = 0; fileIndex < meta.files.length; fileIndex++) {
            const file = meta.files[fileIndex];
            this.assertTiffFileSizeSupported(file);
            const arrayBuffer = await this.readFileAsArrayBufferWithProgress(
                file,
                (fraction) => {
                    if (progressCallback) {
                        progressCallback({
                            stage: 'loading',
                            progress: Math.round(((fileIndex + fraction) / meta.files.length) * 100)
                        });
                    }
                }
            );
            let tiff = null;
            try {
                tiff = new Tiff({ buffer: arrayBuffer });
            } catch (error) {
                throw this.wrapTiffLibraryError(file, error, 'decode TIFF');
            }

            try {
                const pageCount = Math.max(1, tiff.countDirectory());
                for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
                    const includePage = (mode === 'rgb-single')
                        ? (globalPage === 0)
                        : (globalPage % sz === 0);

                    if (includePage) {
                        tiff.setDirectory(pageIndex);

                        if (mode === 'rgb-single') {
                            const rgba = this.readCurrentTiffPageRGBA(tiff, meta.width, meta.height);
                            this.copyRgbPageDownsampled(rgba, dst, meta.width, meta.height, dstNx, dstNy, sx, sy);
                            writtenSlices = 3;
                        } else if (mode === 'uint16-stack') {
                            let gray16 = null;
                            try {
                                gray16 = this.extractUint16FromTiff(meta.width, meta.height, arrayBuffer, pageIndex);
                            } catch (e) {
                                const rgba = this.readCurrentTiffPageRGBA(tiff, meta.width, meta.height);
                                const gray8 = this.rgbaToGrayUint8(rgba);
                                gray16 = new Uint16Array(gray8.length);
                                for (let i = 0; i < gray8.length; i++) {
                                    gray16[i] = gray8[i] * 257;
                                }
                            }

                            this.copyGrayPageDownsampled(
                                gray16,
                                dst,
                                meta.width,
                                meta.height,
                                dstNx,
                                dstNy,
                                sx,
                                sy,
                                writtenSlices * dstSliceSize
                            );
                            writtenSlices++;
                        } else {
                            const rgba = this.readCurrentTiffPageRGBA(tiff, meta.width, meta.height);
                            const gray8 = this.rgbaToGrayUint8(rgba);
                            this.copyGrayPageDownsampled(
                                gray8,
                                dst,
                                meta.width,
                                meta.height,
                                dstNx,
                                dstNy,
                                sx,
                                sy,
                                writtenSlices * dstSliceSize
                            );
                            writtenSlices++;
                        }
                    }

                    globalPage++;
                    if (progressCallback && (globalPage % 4 === 0 || globalPage === meta.totalPages)) {
                        progressCallback({
                            stage: 'processing',
                            progress: Math.round((globalPage / meta.totalPages) * 100)
                        });
                    }
                }
            } finally {
                if (tiff && typeof tiff.close === 'function') {
                    tiff.close();
                }
            }
        }

        const metadata = {
            dimensions: [dstNx, dstNy, dstNz],
            dataType: mode === 'uint16-stack' ? 'uint16' : 'uint8',
            spacing: [1.0 * sx, 1.0 * sy, 1.0 * (mode === 'rgb-single' ? 1 : sz)],
            isRGB: mode === 'rgb-single'
        };
        const volumeData = new VolumeData(dst.buffer, metadata);

        if (progressCallback) {
            progressCallback({ stage: 'complete', progress: 100 });
        }

        return {
            volumeData,
            downsample: {
                mode,
                scale: [sx, sy, mode === 'rgb-single' ? 1 : sz],
                beforeBytes: fullBytes,
                afterBytes: volumeData.data.byteLength,
                applied: sx > 1 || sy > 1 || (mode !== 'rgb-single' && sz > 1)
            }
        };
    }

    /**
     * Single-file TIFF fast path: one read, metadata + decode/downsample in same buffer.
     * This avoids the second full-file read used by the multi-file pipeline.
     */
    async loadSingleTIFFFileAsVolume(file, targetBytes, progressCallback = null) {
        const streamed = await this.tryLoadSingleTIFFViaStreaming(file, targetBytes, progressCallback);
        if (streamed) {
            return streamed;
        }

        if (typeof Tiff === 'undefined') {
            throw new Error('TIFF library not loaded. Please include tiff.js');
        }

        this.assertTiffFileSizeSupported(file);

        const arrayBuffer = await this.readFileAsArrayBufferWithProgress(
            file,
            (fraction) => {
                if (progressCallback) {
                    progressCallback({
                        stage: 'loading',
                        progress: Math.round(fraction * 100)
                    });
                }
            }
        );

        let tiff = null;
        try {
            tiff = new Tiff({ buffer: arrayBuffer });
        } catch (error) {
            throw this.wrapTiffLibraryError(file, error, 'open TIFF');
        }
        try {
            const totalPages = Math.max(1, tiff.countDirectory());
            let width = null;
            let height = null;
            let allUint16Gray = true;
            let hasColor = false;

            if (progressCallback) {
                progressCallback({ stage: 'metadata', progress: 0 });
            }

            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                tiff.setDirectory(pageIndex);

                const pageWidth = tiff.width();
                const pageHeight = tiff.height();
                const bitsPerSample = tiff.getField(258) || 8;
                const samplesPerPixel = tiff.getField(277) || 1;
                const photometric = tiff.getField(262);
                const isGrayscale = samplesPerPixel === 1 && (photometric === 0 || photometric === 1);
                const isUint16 = isGrayscale && bitsPerSample === 16;

                if (width === null || height === null) {
                    width = pageWidth;
                    height = pageHeight;
                } else if (pageWidth !== width || pageHeight !== height) {
                    throw new Error(
                        `TIFF page size mismatch in ${file.name}: expected ${width}x${height}, got ${pageWidth}x${pageHeight}`
                    );
                }

                if (!isGrayscale) hasColor = true;
                if (!isUint16) allUint16Gray = false;

                if (progressCallback && (pageIndex % 8 === 0 || pageIndex === totalPages - 1)) {
                    progressCallback({
                        stage: 'metadata',
                        progress: Math.round(((pageIndex + 1) / totalPages) * 100)
                    });
                }
            }

            const mode = (totalPages === 1 && hasColor)
                ? 'rgb-single'
                : (allUint16Gray ? 'uint16-stack' : 'uint8-stack');

            const bytesPerVoxel = mode === 'uint16-stack' ? 2 : 1;
            const fullDepth = mode === 'rgb-single' ? 3 : totalPages;
            const fullBytes = width * height * fullDepth * bytesPerVoxel;

            const [sx, sy, sz] = this.computeAdaptiveTiffScale(
                width,
                height,
                totalPages,
                mode,
                bytesPerVoxel,
                targetBytes
            );

            const dstNx = Math.max(1, Math.ceil(width / sx));
            const dstNy = Math.max(1, Math.ceil(height / sy));
            const dstNz = mode === 'rgb-single' ? 3 : Math.max(1, Math.ceil(totalPages / sz));
            const TypedArrayCtor = mode === 'uint16-stack' ? Uint16Array : Uint8Array;
            const dst = new TypedArrayCtor(dstNx * dstNy * dstNz);
            const dstSliceSize = dstNx * dstNy;

            if (progressCallback) {
                progressCallback({ stage: 'processing', progress: 0 });
            }

            let writtenSlices = 0;
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const includePage = (mode === 'rgb-single')
                    ? (pageIndex === 0)
                    : (pageIndex % sz === 0);

                if (includePage) {
                    tiff.setDirectory(pageIndex);
                    if (mode === 'rgb-single') {
                        const rgba = this.readCurrentTiffPageRGBA(tiff, width, height);
                        this.copyRgbPageDownsampled(rgba, dst, width, height, dstNx, dstNy, sx, sy);
                        writtenSlices = 3;
                    } else if (mode === 'uint16-stack') {
                        let gray16 = null;
                        try {
                            gray16 = this.extractUint16FromTiff(width, height, arrayBuffer, pageIndex);
                        } catch (e) {
                            const rgba = this.readCurrentTiffPageRGBA(tiff, width, height);
                            const gray8 = this.rgbaToGrayUint8(rgba);
                            gray16 = new Uint16Array(gray8.length);
                            for (let i = 0; i < gray8.length; i++) {
                                gray16[i] = gray8[i] * 257;
                            }
                        }
                        this.copyGrayPageDownsampled(
                            gray16,
                            dst,
                            width,
                            height,
                            dstNx,
                            dstNy,
                            sx,
                            sy,
                            writtenSlices * dstSliceSize
                        );
                        writtenSlices++;
                    } else {
                        const rgba = this.readCurrentTiffPageRGBA(tiff, width, height);
                        const gray8 = this.rgbaToGrayUint8(rgba);
                        this.copyGrayPageDownsampled(
                            gray8,
                            dst,
                            width,
                            height,
                            dstNx,
                            dstNy,
                            sx,
                            sy,
                            writtenSlices * dstSliceSize
                        );
                        writtenSlices++;
                    }
                }

                if (progressCallback && (pageIndex % 4 === 0 || pageIndex === totalPages - 1)) {
                    progressCallback({
                        stage: 'processing',
                        progress: Math.round(((pageIndex + 1) / totalPages) * 100)
                    });
                }
            }

            const metadata = {
                dimensions: [dstNx, dstNy, dstNz],
                dataType: mode === 'uint16-stack' ? 'uint16' : 'uint8',
                spacing: [1.0 * sx, 1.0 * sy, 1.0 * (mode === 'rgb-single' ? 1 : sz)],
                isRGB: mode === 'rgb-single'
            };
            const volumeData = new VolumeData(dst.buffer, metadata);

            if (progressCallback) {
                progressCallback({ stage: 'complete', progress: 100 });
            }

            return {
                volumeData,
                downsample: {
                    mode,
                    scale: [sx, sy, mode === 'rgb-single' ? 1 : sz],
                    beforeBytes: fullBytes,
                    afterBytes: volumeData.data.byteLength,
                    applied: sx > 1 || sy > 1 || (mode !== 'rgb-single' && sz > 1)
                }
            };
        } finally {
            if (tiff && typeof tiff.close === 'function') {
                tiff.close();
            }
        }
    }

    async tryLoadSingleTIFFViaStreaming(file, targetBytes, progressCallback = null) {
        if (typeof TiffStreamReader === 'undefined') {
            return null;
        }

        let reader = null;
        try {
            reader = new TiffStreamReader(file);
            const pages = await reader.scanPages();
            if (!Array.isArray(pages) || pages.length === 0) {
                return null;
            }

            if (progressCallback) {
                progressCallback({ stage: 'metadata', progress: 100 });
            }

            const first = pages[0];
            const width = first.width;
            const height = first.height;
            if (!width || !height) {
                return null;
            }

            const hasColor = pages.some((p) => p.samplesPerPixel >= 3 && !(p.photometric === 0 || p.photometric === 1));
            const allUint16Gray = pages.every((p) =>
                p.samplesPerPixel === 1 &&
                (p.photometric === 0 || p.photometric === 1) &&
                p.bitsPerSample === 16
            );
            const mode = (pages.length === 1 && hasColor)
                ? 'rgb-single'
                : (allUint16Gray ? 'uint16-stack' : 'uint8-stack');

            const unsupported = pages.find((p) => !reader.canStreamPage(p));
            if (unsupported) {
                const reason = reader.getUnsupportedReason(unsupported) || 'Unsupported TIFF layout';
                if (file.size > this.getTiffSingleFileHardLimitBytes()) {
                    throw new Error(
                        `${reason}. File is too large for fallback TIFF decoder path. ` +
                        'Use a TIFF stack (many smaller files) or convert to DICOM/RAW.'
                    );
                }
                return null;
            }

            const bytesPerVoxel = mode === 'uint16-stack' ? 2 : 1;
            const fullDepth = mode === 'rgb-single' ? 3 : pages.length;
            const fullBytes = width * height * fullDepth * bytesPerVoxel;
            const [sx, sy, sz] = this.computeAdaptiveTiffScale(
                width,
                height,
                pages.length,
                mode,
                bytesPerVoxel,
                targetBytes
            );

            const dstNx = Math.max(1, Math.ceil(width / sx));
            const dstNy = Math.max(1, Math.ceil(height / sy));
            const dstNz = mode === 'rgb-single' ? 3 : Math.max(1, Math.ceil(pages.length / sz));
            const TypedArrayCtor = mode === 'uint16-stack' ? Uint16Array : Uint8Array;
            const dst = new TypedArrayCtor(dstNx * dstNy * dstNz);
            const dstSliceSize = dstNx * dstNy;

            if (progressCallback) {
                progressCallback({ stage: 'processing', progress: 0 });
            }

            let writtenSlices = 0;
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
                const includePage = (mode === 'rgb-single')
                    ? (pageIndex === 0)
                    : (pageIndex % sz === 0);

                if (includePage) {
                    const page = pages[pageIndex];
                    if (mode === 'rgb-single') {
                        const rgb = await reader.decodePageToRgbDownsampled(page, sx, sy, dstNx, dstNy);
                        dst.set(rgb.r, 0);
                        dst.set(rgb.g, dstSliceSize);
                        dst.set(rgb.b, dstSliceSize * 2);
                        writtenSlices = 3;
                    } else {
                        const targetType = mode === 'uint16-stack' ? 'uint16' : 'uint8';
                        const gray = await reader.decodePageToGrayDownsampled(page, sx, sy, dstNx, dstNy, targetType);
                        dst.set(gray, writtenSlices * dstSliceSize);
                        writtenSlices++;
                    }
                }

                if (progressCallback && (pageIndex % 4 === 0 || pageIndex === pages.length - 1)) {
                    progressCallback({
                        stage: 'processing',
                        progress: Math.round(((pageIndex + 1) / pages.length) * 100)
                    });
                }
            }

            const metadata = {
                dimensions: [dstNx, dstNy, dstNz],
                dataType: mode === 'uint16-stack' ? 'uint16' : 'uint8',
                spacing: [1.0 * sx, 1.0 * sy, 1.0 * (mode === 'rgb-single' ? 1 : sz)],
                isRGB: mode === 'rgb-single'
            };
            const volumeData = new VolumeData(dst.buffer, metadata);

            if (progressCallback) {
                progressCallback({ stage: 'complete', progress: 100 });
            }

            return {
                volumeData,
                downsample: {
                    mode,
                    scale: [sx, sy, mode === 'rgb-single' ? 1 : sz],
                    beforeBytes: fullBytes,
                    afterBytes: volumeData.data.byteLength,
                    applied: sx > 1 || sy > 1 || (mode !== 'rgb-single' && sz > 1)
                }
            };
        } catch (error) {
            const message = (error && error.message) ? error.message : String(error || '');
            if (file.size > this.getTiffSingleFileHardLimitBytes()) {
                throw new Error(
                    `Streaming TIFF path failed for ${file.name}: ${message}. ` +
                    'Use a TIFF stack (many smaller files) or convert to DICOM/RAW.'
                );
            }
            return null;
        }
    }

    getTiffSingleFileHardLimitBytes() {
        if (typeof ViewerConfig !== 'undefined' &&
            ViewerConfig.limits &&
            Number.isFinite(ViewerConfig.limits.tiffSingleFileHardLimitBytes)) {
            return ViewerConfig.limits.tiffSingleFileHardLimitBytes;
        }
        return 1024 * 1024 * 1024;
    }

    assertTiffFileSizeSupported(file) {
        if (!file || !Number.isFinite(file.size)) return;
        const hardLimit = this.getTiffSingleFileHardLimitBytes();
        if (!Number.isFinite(hardLimit) || hardLimit <= 0) return;
        if (file.size <= hardLimit) return;

        const sizeGB = (file.size / (1024 * 1024 * 1024)).toFixed(2);
        const limitGB = (hardLimit / (1024 * 1024 * 1024)).toFixed(2);
        throw new Error(
            `Single TIFF file is ${sizeGB} GB, which exceeds browser TIFF decoder limit (${limitGB} GB). ` +
            'Use a TIFF stack (many smaller files) or convert to DICOM/RAW.'
        );
    }

    wrapTiffLibraryError(file, error, actionLabel) {
        const baseMessage = (error && error.message) ? error.message : String(error || 'unknown error');
        const isAbort = /abort\(\{\}\)|_TIFFOpen|TIFFOpen/i.test(baseMessage);
        const fileName = file && file.name ? file.name : 'TIFF file';

        if (!isAbort) {
            return new Error(`Failed to ${actionLabel} (${fileName}): ${baseMessage}`);
        }

        const limitGB = (this.getTiffSingleFileHardLimitBytes() / (1024 * 1024 * 1024)).toFixed(2);
        return new Error(
            `TIFF decoder ran out of memory while trying to ${actionLabel} (${fileName}). ` +
            `Single-file TIFF support is effectively limited to around ${limitGB} GB in this browser path. ` +
            'Use a TIFF stack (many smaller files) or convert to DICOM/RAW.'
        );
    }

    computeAdaptiveTiffScale(width, height, depth, mode, bytesPerVoxel, targetBytes) {
        if (mode === 'rgb-single') {
            const rawBytes = width * height * 3;
            if (rawBytes <= targetBytes) return [1, 1, 1];

            let sxy = Math.max(2, Math.ceil(Math.sqrt(rawBytes / targetBytes)));
            const estimate = () => Math.ceil(width / sxy) * Math.ceil(height / sxy) * 3;
            while (estimate() > targetBytes && (sxy < width || sxy < height)) {
                sxy++;
            }
            return [sxy, sxy, 1];
        }

        const rawBytes = width * height * depth * bytesPerVoxel;
        if (rawBytes <= targetBytes) return [1, 1, 1];

        let sx = Math.max(2, Math.ceil(Math.cbrt(rawBytes / targetBytes)));
        let sy = sx;
        let sz = sx;

        const estimate = () =>
            Math.ceil(width / sx) *
            Math.ceil(height / sy) *
            Math.ceil(depth / sz) *
            bytesPerVoxel;

        while (estimate() > targetBytes && (sx < width || sy < height || sz < depth)) {
            if (sx <= sy && sx <= sz && sx < width) {
                sx++;
            } else if (sy <= sx && sy <= sz && sy < height) {
                sy++;
            } else if (sz < depth) {
                sz++;
            } else {
                if (sx < width) sx++;
                if (sy < height) sy++;
                if (sz < depth) sz++;
            }
        }

        return [sx, sy, sz];
    }

    copyGrayPageDownsampled(src, dst, srcW, srcH, dstW, dstH, sx, sy, dstOffset) {
        for (let dy = 0; dy < dstH; dy++) {
            const srcY = Math.min(dy * sy, srcH - 1);
            for (let dx = 0; dx < dstW; dx++) {
                const srcX = Math.min(dx * sx, srcW - 1);
                dst[dstOffset + dx + dy * dstW] = src[srcX + srcY * srcW];
            }
        }
    }

    copyRgbPageDownsampled(rgba, dst, srcW, srcH, dstW, dstH, sx, sy) {
        const sliceSize = dstW * dstH;
        for (let dy = 0; dy < dstH; dy++) {
            const srcY = Math.min(dy * sy, srcH - 1);
            for (let dx = 0; dx < dstW; dx++) {
                const srcX = Math.min(dx * sx, srcW - 1);
                const srcIdx = (srcX + srcY * srcW) * 4;
                const dstIdx = dx + dy * dstW;
                dst[dstIdx] = rgba[srcIdx];
                dst[dstIdx + sliceSize] = rgba[srcIdx + 1];
                dst[dstIdx + sliceSize * 2] = rgba[srcIdx + 2];
            }
        }
    }

    readCurrentTiffPageRGBA(tiff, width, height) {
        const canvas = tiff.toCanvas();
        if (!canvas || canvas.width !== width || canvas.height !== height) {
            throw new Error('Failed to render TIFF page to canvas');
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get canvas context for TIFF page');
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        return imageData.data;
    }

    rgbaToGrayUint8(rgbaData) {
        const length = Math.floor(rgbaData.length / 4);
        const gray = new Uint8Array(length);
        for (let i = 0, j = 0; i < rgbaData.length; i += 4, j++) {
            gray[j] = rgbaData[i];
        }
        return gray;
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
     * Extract uint16 values from TIFF raw buffer
     */
    extractUint16FromTiff(width, height, rawBuffer, pageIndex = 0) {
        const data = new Uint16Array(width * height);
        const dataView = new DataView(rawBuffer);
        const expectedDataSize = width * height * 2;

        // Detect endianness from TIFF header
        const byteOrder = dataView.getUint16(0, false);
        const littleEndian = (byteOrder === 0x4949); // 'II' = little endian

        const ifdOffsets = this.getTiffIFDOffsets(dataView, littleEndian);
        if (ifdOffsets.length === 0) {
            throw new Error('No TIFF IFDs found');
        }

        const ifdOffset = ifdOffsets[Math.max(0, Math.min(pageIndex, ifdOffsets.length - 1))];
        const tags = this.parseTiffIFDAtOffset(dataView, littleEndian, ifdOffset);

        const rowsPerStrip = tags.rowsPerStrip || height;
        const stripOffsetsArray = tags.stripOffsets || [];

        // Calculate fallback offset (assume data at end of file)
        let fallbackOffset = rawBuffer.byteLength - expectedDataSize;
        if (fallbackOffset < 8) fallbackOffset = 8;

        try {
            if (stripOffsetsArray.length > 0 && stripOffsetsArray[0] < rawBuffer.byteLength) {
                // Strip-based TIFF with valid offsets
                let destY = 0;
                for (let s = 0; s < stripOffsetsArray.length && destY < height; s++) {
                    const offset = stripOffsetsArray[s];
                    const rowsInThisStrip = Math.min(rowsPerStrip, height - destY);

                    for (let row = 0; row < rowsInThisStrip; row++) {
                        const destRowStart = (destY + row) * width;
                        const srcRowStart = row * width;
                        for (let x = 0; x < width; x++) {
                            const srcOffset = offset + (srcRowStart + x) * 2;
                            if (srcOffset + 2 <= rawBuffer.byteLength) {
                                data[destRowStart + x] = dataView.getUint16(srcOffset, littleEndian);
                            }
                        }
                    }
                    destY += rowsInThisStrip;
                }
            } else {
                // Fallback: assume data is at end of buffer
                for (let i = 0; i < data.length; i++) {
                    data[i] = dataView.getUint16(fallbackOffset + i * 2, littleEndian);
                }
            }
        } catch (e) {
            if (pageIndex > 0) {
                throw new Error(`Failed to extract uint16 TIFF page ${pageIndex}: ${e.message}`);
            }
            // Fallback on any error
            console.warn('TIFF extraction failed, using fallback:', e.message);
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
     * Parse TIFF IFD chain and return all directory offsets.
     */
    getTiffIFDOffsets(dataView, littleEndian) {
        const offsets = [];
        let ifdOffset = dataView.getUint32(4, littleEndian);
        let guard = 0;

        while (ifdOffset > 0 && ifdOffset + 2 < dataView.byteLength && guard < 4096) {
            offsets.push(ifdOffset);

            const numEntries = dataView.getUint16(ifdOffset, littleEndian);
            const nextIfdPos = ifdOffset + 2 + numEntries * 12;
            if (nextIfdPos + 4 > dataView.byteLength) break;

            ifdOffset = dataView.getUint32(nextIfdPos, littleEndian);
            guard++;
        }

        return offsets;
    }

    /**
     * Parse a single TIFF IFD.
     */
    parseTiffIFDAtOffset(dataView, littleEndian, ifdOffset) {
        const tags = {};

        try {
            // Number of directory entries
            const numEntries = dataView.getUint16(ifdOffset, littleEndian);

            for (let i = 0; i < numEntries; i++) {
                const entryOffset = ifdOffset + 2 + (i * 12);
                const tagId = dataView.getUint16(entryOffset, littleEndian);
                const tagType = dataView.getUint16(entryOffset + 2, littleEndian);
                const count = dataView.getUint32(entryOffset + 4, littleEndian);

                // Type sizes: 1=BYTE(1), 2=ASCII(1), 3=SHORT(2), 4=LONG(4), 5=RATIONAL(8)
                const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
                const typeSize = typeSizes[tagType] || 1;
                const totalSize = typeSize * count;

                // If data fits in 4 bytes, it's in the entry; otherwise it's an offset
                let valueOffset = entryOffset + 8;
                if (totalSize > 4) {
                    valueOffset = dataView.getUint32(entryOffset + 8, littleEndian);
                }

                // Read values based on tag
                if (tagId === 273) { // StripOffsets
                    tags.stripOffsets = [];
                    for (let j = 0; j < count; j++) {
                        if (tagType === 3) { // SHORT
                            tags.stripOffsets.push(dataView.getUint16(valueOffset + j * 2, littleEndian));
                        } else { // LONG
                            tags.stripOffsets.push(dataView.getUint32(valueOffset + j * 4, littleEndian));
                        }
                    }
                } else if (tagId === 278) { // RowsPerStrip
                    if (tagType === 3) {
                        tags.rowsPerStrip = dataView.getUint16(valueOffset, littleEndian);
                    } else {
                        tags.rowsPerStrip = dataView.getUint32(valueOffset, littleEndian);
                    }
                } else if (tagId === 279) { // StripByteCounts
                    tags.stripByteCounts = [];
                    for (let j = 0; j < count; j++) {
                        if (tagType === 3) {
                            tags.stripByteCounts.push(dataView.getUint16(valueOffset + j * 2, littleEndian));
                        } else {
                            tags.stripByteCounts.push(dataView.getUint32(valueOffset + j * 4, littleEndian));
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to parse TIFF IFD:', e.message);
        }

        return tags;
    }

    /**
     * Detect file type
     * @param {File} file
     * @returns {string} File type ('2d-image', 'tiff', 'raw', 'json', 'unknown')
     */
    detectFileType(file) {
        const ext = this.getFileExtension(file.name).toLowerCase();

        if (this.isRawExt(ext)) return 'raw';
        if (ext === 'json') return 'json';
        if (ext === 'dat') return 'dat';
        if (this.isTiffExt(ext)) return 'tiff';
        if (this.isDicomExt(ext)) return 'dicom';
        if (this.isNiftiFileName(file.name)) return 'nifti';
        if (this.supportedImageFormats.includes(ext)) return '2d-image';

        return 'unknown';
    }

    isRawExt(ext) {
        return this.formats.raw.includes(ext);
    }

    isRawMetadataExt(ext) {
        return this.formats.rawMetadata.includes(ext);
    }

    isTiffExt(ext) {
        return this.formats.tiff.includes(ext);
    }

    isDicomExt(ext) {
        return this.formats.dicom.includes(ext);
    }

    /**
     * Load a DICOM series and convert to VolumeData
     * @param {object} seriesGroup
     * @param {Function} progressCallback
     * @returns {Promise<VolumeData>}
     */
    async loadDICOMSeries(seriesGroup, progressCallback) {
        return this.dicomLoader.loadSeries(seriesGroup, progressCallback);
    }

    /**
     * Load a DICOM series with progressive/streaming behavior
     * @param {object} seriesGroup
     * @param {object} callbacks
     * @returns {Promise<ProgressiveVolumeData|StreamingVolumeData|DicomStreamingVolumeData>}
     */
    async loadDICOMSeriesProgressive(seriesGroup, callbacks) {
        return this.dicomLoader.loadSeriesProgressive(seriesGroup, callbacks);
    }

    /**
     * Load a NIfTI file and convert to VolumeData
     * @param {File} file
     * @returns {Promise<VolumeData>}
     */
    async loadNifti(file, progressCallback = null) {
        return this.niftiLoader.loadNifti(file, progressCallback);
    }

    /**
     * Parse NIfTI header only (no full voxel decode)
     * @param {File} file
     * @returns {Promise<object>}
     */
    async loadNiftiHeader(file) {
        return this.niftiLoader.parseNiftiHeaderFromFile(file);
    }

    /**
     * Create low-res NIfTI preview directly from file bytes
     * @param {File} file
     * @param {object} header
     * @param {number} downsampleScale
     * @param {function|null} progressCallback
     * @returns {Promise<object>}
     */
    async createNiftiLowResPreview(file, header, downsampleScale = 4, progressCallback = null) {
        return this.niftiLoader.createLowResPreviewFromFile(file, header, downsampleScale, progressCallback);
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
