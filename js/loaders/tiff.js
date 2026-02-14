class TiffVolumeLoader {
    constructor(viewer) {
        this.viewer = viewer;
    }

    nowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    formatSeconds(ms) {
        return `${(ms / 1000).toFixed(2)}s`;
    }

    logPreviewReady(name, startMs, details = '') {
        const elapsed = this.nowMs() - startMs;
        const suffix = details ? ` (${details})` : '';
        console.log(`[LoadTiming][TIFF] Preview ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    logFinalReady(name, startMs, details = '') {
        const elapsed = this.nowMs() - startMs;
        const suffix = details ? ` (${details})` : '';
        console.log(`[LoadTiming][TIFF] Final ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    async load(fileGroup) {
        const viewer = this.viewer;
        const loadStartMs = this.nowMs();
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            viewer.status.showLoadingIndicator('Loading TIFF...');

            const tiffFiles = Array.isArray(fileGroup.files) && fileGroup.files.length > 0
                ? fileGroup.files
                : [fileGroup.file];

            const targetBytes = this.getAutoDownsampleTargetBytes();
            const loadResult = await viewer.fileParser.loadTIFFGroupAsVolume(
                tiffFiles,
                { targetBytes },
                (progress) => viewer.status.updateLoadingProgress(progress)
            );
            let volumeData = loadResult.volumeData;
            const downsampleInfo = loadResult.downsample || null;
            const isSourceDownsampled = !!(downsampleInfo && downsampleInfo.applied);
            const sourceBytes = (downsampleInfo && Number.isFinite(downsampleInfo.beforeBytes))
                ? downsampleInfo.beforeBytes
                : ((volumeData && volumeData.data && Number.isFinite(volumeData.data.byteLength))
                    ? volumeData.data.byteLength
                    : null);
            const fullLoadedBytes = (downsampleInfo && Number.isFinite(downsampleInfo.afterBytes))
                ? downsampleInfo.afterBytes
                : ((volumeData && volumeData.data && Number.isFinite(volumeData.data.byteLength))
                    ? volumeData.data.byteLength
                    : null);

            if (isSourceDownsampled) {
                const [sx, sy, sz] = downsampleInfo.scale;
                console.warn(
                    `TIFF auto-downsampled by ${sx}x${sy}x${sz} ` +
                    `(${(downsampleInfo.beforeBytes / (1024 * 1024)).toFixed(1)}MB -> ${(downsampleInfo.afterBytes / (1024 * 1024)).toFixed(1)}MB)`
                );
            }

            const PROGRESSIVE_THRESHOLD = (typeof WebGLUtils !== 'undefined' &&
                typeof WebGLUtils.getVolumeProgressiveThresholdBytes === 'function')
                ? WebGLUtils.getVolumeProgressiveThresholdBytes()
                : 50 * 1024 * 1024;

            const volumeBytes = volumeData && volumeData.data ? volumeData.data.byteLength : 0;
            const is3D = volumeData && volumeData.dimensions && volumeData.dimensions[2] > 1;

            if (is3D && volumeBytes > PROGRESSIVE_THRESHOLD) {
                await this.loadProgressive(fileGroup, volumeData, isSourceDownsampled, sourceBytes, fullLoadedBytes, loadStartMs);
            } else {
                await this.loadDirect(fileGroup, volumeData, isSourceDownsampled, sourceBytes, fullLoadedBytes, loadStartMs);
            }

        } catch (error) {
            viewer.status.hideLoadingIndicator();
            const message = (error && error.message) ? error.message : String(error);
            if (/abort\(\{\}\)|_TIFFOpen|TIFFOpen/i.test(message)) {
                throw new Error(
                    'TIFF decoder ran out of memory for this single file. ' +
                    'Use a TIFF stack (many smaller files) or convert to DICOM/RAW.'
                );
            }
            throw error;
        }
    }

    async loadDirect(fileGroup, volumeData, isSourceDownsampled = false, sourceBytes = null, loadedBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();
        viewer.switchToCTMode();

        const info = viewer.ctViewer.loadVolume(volumeData);
        viewer.updateVolumeState({
            name: fileGroup.name,
            dimensions: info.dimensions,
            dataType: info.dataType,
            isStreaming: false,
            hasFullData: true,
            lowResVolume: null,
            isSourceDownsampled,
            sourceBytes,
            loadedBytes
        });
        viewer.update3DResolutionOptions('full');
        viewer.applySmart3DResolutionDefault().catch((error) => {
            console.warn('Auto 3D resolution selection failed:', error);
        });

        if (viewer.histogram) {
            viewer.histogram.setVolume(volumeData);
        }

        viewer.status.updateVolumeUI({
            name: fileGroup.name,
            dimensions: info.dimensions,
            label: info.dataType
        });
        this.logFinalReady(fileGroup.name, startMs, 'direct');

        viewer.status.hideLoadingIndicator();
    }

    async loadProgressive(fileGroup, volumeData, isSourceDownsampled = false, sourceBytes = null, fullLoadedBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();
        viewer.switchToCTMode();

        let progressiveData = null;
        const metadata = {
            dimensions: volumeData.dimensions,
            dataType: volumeData.dataType,
            spacing: volumeData.spacing
        };

        const callbacks = {
            onProgress: (progress) => {
                viewer.status.updateLoadingProgress(progress);
            },
            onLowResReady: (lowResVolume, progData) => {
                progressiveData = progData;
                viewer.ctViewer.progressiveVolume = progData;
                viewer.ctViewer.volumeData = progData;

                viewer.updateVolumeState({
                    name: fileGroup.name,
                    dimensions: progData.dimensions,
                    dataType: progData.dataType,
                    isStreaming: !!progData.isStreaming,
                    hasFullData: false,
                    lowResVolume,
                    isSourceDownsampled,
                    sourceBytes,
                    loadedBytes: (lowResVolume && lowResVolume.data && Number.isFinite(lowResVolume.data.byteLength))
                        ? lowResVolume.data.byteLength
                        : null
                });
                viewer.status.updateVolumeUI({
                    name: fileGroup.name,
                    dimensions: progData.dimensions,
                    label: 'Progressive',
                    loading: true
                });

                if (viewer.histogram) {
                    viewer.histogram.setVolume(progData);
                }

                viewer.update3DResolutionOptions('low');
                viewer.status.hideLoadingIndicator();
                viewer.ctViewer.handleLowResReady(lowResVolume);
                this.logPreviewReady(fileGroup.name, startMs, `low=${lowResVolume.dimensions.join('x')}`);
            },
            onBlockReady: (blockIndex, zStart, zEnd) => {
                viewer.ctViewer.handleBlockReady(blockIndex, zStart, zEnd);
            },
            onAllBlocksReady: () => {
                viewer.updateVolumeState({
                    name: fileGroup.name,
                    dimensions: progressiveData.dimensions,
                    dataType: progressiveData.dataType,
                    isStreaming: false,
                    hasFullData: true,
                    isSourceDownsampled,
                    sourceBytes,
                    loadedBytes: (progressiveData && progressiveData.data && Number.isFinite(progressiveData.data.byteLength))
                        ? progressiveData.data.byteLength
                        : fullLoadedBytes
                });
                viewer.status.updateVolumeUI({
                    name: fileGroup.name,
                    dimensions: progressiveData.dimensions,
                    label: progressiveData.dataType
                });

                viewer.ctViewer.handleAllBlocksReady();
                viewer.update3DResolutionOptions();
                viewer.applySmart3DResolutionDefault().catch((error) => {
                    console.warn('Auto 3D resolution selection failed:', error);
                });
                this.logFinalReady(fileGroup.name, startMs, `full=${progressiveData.dimensions.join('x')}`);
            }
        };

        const loader = new ProgressiveVolumeLoader();
        await loader.loadProgressive(volumeData.data.buffer, metadata, callbacks);
    }

    getAutoDownsampleTargetBytes() {
        const FALLBACK = 512 * 1024 * 1024; // 512MB
        const MAX_TARGET = 1024 * 1024 * 1024; // 1GB

        // Use a conservative fraction of reported device memory, then clamp.
        if (typeof navigator !== 'undefined' && Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory > 0) {
            const estimated = Math.round(navigator.deviceMemory * 0.125 * 1024 * 1024 * 1024);
            return Math.max(FALLBACK, Math.min(MAX_TARGET, estimated));
        }

        return FALLBACK;
    }
}

window.TiffVolumeLoader = TiffVolumeLoader;
