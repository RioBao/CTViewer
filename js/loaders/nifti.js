class NiftiVolumeLoader {
    constructor(viewer) {
        this.viewer = viewer;
        this.activeHybridLoadToken = 0;
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
        console.log(`[LoadTiming][NIfTI] Preview ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    logFinalReady(name, startMs, details = '') {
        const elapsed = this.nowMs() - startMs;
        const suffix = details ? ` (${details})` : '';
        console.log(`[LoadTiming][NIfTI] Final ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    async load(fileGroup) {
        const viewer = this.viewer;
        const loadStartMs = this.nowMs();
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            this.activeHybridLoadToken += 1;
            viewer.status.showLoadingIndicator('Loading NIfTI...');

            const PROGRESSIVE_THRESHOLD = this.getProgressiveThresholdBytes();
            const sourceBytes = Number.isFinite(fileGroup.file && fileGroup.file.size)
                ? fileGroup.file.size
                : null;
            const lowerName = String(fileGroup.file && fileGroup.file.name ? fileGroup.file.name : '').toLowerCase();
            const isGz = lowerName.endsWith('.nii.gz');
            if (!isGz && Number.isFinite(sourceBytes) && sourceBytes > PROGRESSIVE_THRESHOLD) {
                const header = await viewer.fileParser.loadNiftiHeader(fileGroup.file);
                const is3D = header && header.metadata && header.metadata.dimensions && header.metadata.dimensions[2] > 1;
                if (is3D) {
                    await this.loadHybrid(fileGroup, header, sourceBytes, loadStartMs);
                    return;
                }
            }

            const volumeData = await viewer.fileParser.loadNifti(
                fileGroup.file,
                (progress) => viewer.status.updateLoadingProgress(progress)
            );

            const volumeBytes = volumeData && volumeData.data ? volumeData.data.byteLength : 0;
            const is3D = volumeData && volumeData.dimensions && volumeData.dimensions[2] > 1;

            if (is3D && volumeBytes > PROGRESSIVE_THRESHOLD) {
                await this.loadProgressive(fileGroup, volumeData, sourceBytes, loadStartMs);
            } else {
                await this.loadDirect(fileGroup, volumeData, sourceBytes, loadStartMs);
            }
        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }

    getProgressiveThresholdBytes() {
        return (typeof WebGLUtils !== 'undefined' &&
            typeof WebGLUtils.getVolumeProgressiveThresholdBytes === 'function')
            ? WebGLUtils.getVolumeProgressiveThresholdBytes()
            : 50 * 1024 * 1024;
    }

    getProgressiveDownsampleScale() {
        if (typeof ViewerConfig !== 'undefined' &&
            ViewerConfig.progressive &&
            Number.isFinite(ViewerConfig.progressive.downsampleScale)) {
            return Math.max(1, Math.floor(ViewerConfig.progressive.downsampleScale));
        }
        return 4;
    }

    getProgressiveNumBlocks() {
        if (typeof ViewerConfig !== 'undefined' &&
            ViewerConfig.progressive &&
            Number.isFinite(ViewerConfig.progressive.numBlocks)) {
            return Math.max(1, Math.floor(ViewerConfig.progressive.numBlocks));
        }
        return 5;
    }

    calculateBlockBoundaries(nz, numBlocks) {
        const boundaries = [0];
        const blockSize = Math.ceil(nz / numBlocks);
        for (let i = 1; i < numBlocks; i++) {
            boundaries.push(Math.min(i * blockSize, nz));
        }
        boundaries.push(nz);
        return boundaries;
    }

    async loadHybrid(fileGroup, header, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        viewer.switchToCTMode();
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();

        const downsampleScale = this.getProgressiveDownsampleScale();
        const token = this.activeHybridLoadToken;

        const preview = await viewer.fileParser.createNiftiLowResPreview(
            fileGroup.file,
            header,
            downsampleScale,
            (percent) => viewer.status.updateLoadingProgress({ stage: 'streaming', progress: percent })
        );

        const lowResVolume = preview && preview.lowResVolume ? preview.lowResVolume : null;
        if (!lowResVolume || !lowResVolume.data || !lowResVolume.dimensions) {
            throw new Error('Failed to create low-resolution NIfTI preview');
        }

        const metadata = {
            dimensions: header.metadata.dimensions,
            dataType: 'float32',
            spacing: header.metadata.spacing,
            niftiOrientation: header.metadata.niftiOrientation
        };
        const numBlocks = this.getProgressiveNumBlocks();
        const blockBoundaries = this.calculateBlockBoundaries(metadata.dimensions[2], numBlocks);
        const progressiveData = new StreamingVolumeData(metadata, fileGroup.file, blockBoundaries);
        progressiveData.setLowResData(lowResVolume, lowResVolume.min, lowResVolume.max);
        progressiveData.lowResScale = downsampleScale;
        progressiveData.markFullyLoaded();
        progressiveData.disableAsyncLoads = true;
        progressiveData.metadata = metadata;

        viewer.ctViewer.progressiveVolume = progressiveData;
        viewer.ctViewer.volumeData = progressiveData;

        const name = fileGroup.name || 'NIfTI';
        const orientationInfo = header && header.metadata ? header.metadata.niftiOrientation || null : null;

        viewer.updateVolumeState({
            name,
            dimensions: metadata.dimensions,
            dataType: metadata.dataType,
            isStreaming: true,
            hasFullData: false,
            lowResVolume,
            orientationInfo,
            sourceBytes,
            loadedBytes: Number.isFinite(lowResVolume.data.byteLength) ? lowResVolume.data.byteLength : null
        });

        viewer.status.updateVolumeUI({
            name,
            dimensions: metadata.dimensions,
            label: 'Progressive',
            loading: true
        });

        if (viewer.histogram) {
            viewer.histogram.setVolume(progressiveData);
        }

        viewer.update3DResolutionOptions('low');
        viewer.status.hideLoadingIndicator();
        viewer.ctViewer.handleLowResReady(lowResVolume);
        this.logPreviewReady(name, startMs, `low=${lowResVolume.dimensions.join('x')}`);

        this.finishHybridLoad(token, fileGroup, metadata, lowResVolume, progressiveData, sourceBytes, startMs)
            .catch((error) => {
                console.error('NIfTI hybrid full-load failed:', error);
            });
    }

    async finishHybridLoad(token, fileGroup, metadata, lowResVolume, previewData, sourceBytes = null, startMs = null) {
        const viewer = this.viewer;
        const fullVolume = await viewer.fileParser.loadNifti(fileGroup.file);

        if (token !== this.activeHybridLoadToken) {
            return;
        }
        if (viewer.ctViewer.volumeData !== previewData && viewer.ctViewer.progressiveVolume !== previewData) {
            return;
        }

        const numBlocks = this.getProgressiveNumBlocks();
        const blockBoundaries = this.calculateBlockBoundaries(metadata.dimensions[2], numBlocks);
        const fullProgressive = new ProgressiveVolumeData(metadata, fullVolume.data, blockBoundaries);
        fullProgressive.setLowResData(lowResVolume, fullVolume.min, fullVolume.max);
        fullProgressive.lowResScale = this.getProgressiveDownsampleScale();
        for (let i = 0; i < numBlocks; i++) {
            fullProgressive.activateBlock(i);
        }
        fullProgressive.markFullyLoaded();
        fullProgressive.min = fullVolume.min;
        fullProgressive.max = fullVolume.max;
        fullProgressive.metadata = metadata;

        viewer.ctViewer.progressiveVolume = fullProgressive;
        viewer.ctViewer.volumeData = fullProgressive;

        Object.values(viewer.ctViewer.renderers).forEach((renderer) => {
            renderer.setDataRange(fullProgressive.min, fullProgressive.max);
        });
        viewer.ctViewer.renderAllViews();

        if (viewer.histogram) {
            viewer.histogram.setVolume(fullProgressive);
        }

        const name = fileGroup.name || 'NIfTI';
        const orientationInfo = metadata.niftiOrientation || null;
        viewer.updateVolumeState({
            name,
            dimensions: metadata.dimensions,
            dataType: metadata.dataType,
            isStreaming: false,
            hasFullData: true,
            lowResVolume,
            orientationInfo,
            sourceBytes,
            loadedBytes: (fullVolume && fullVolume.data && Number.isFinite(fullVolume.data.byteLength))
                ? fullVolume.data.byteLength
                : viewer.volumeState.loadedBytes
        });

        viewer.status.updateVolumeUI({
            name,
            dimensions: metadata.dimensions,
            label: `NIfTI ${metadata.dataType}`
        });
        viewer.ctViewer.handleAllBlocksReady();
        viewer.update3DResolutionOptions();
        viewer.applySmart3DResolutionDefault().catch((error) => {
            console.warn('Auto 3D resolution selection failed:', error);
        });
        const baseline = Number.isFinite(startMs) ? startMs : this.nowMs();
        this.logFinalReady(name, baseline, `full=${metadata.dimensions.join('x')}`);
    }

    async loadDirect(fileGroup, volumeData, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        viewer.switchToCTMode();
        const orientationInfo = volumeData && volumeData.metadata
            ? volumeData.metadata.niftiOrientation || null
            : null;
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();

        const info = viewer.ctViewer.loadVolume(volumeData);
        viewer.updateVolumeState({
            name: fileGroup.name || 'NIfTI',
            dimensions: info.dimensions,
            dataType: info.dataType,
            isStreaming: false,
            hasFullData: true,
            lowResVolume: null,
            orientationInfo,
            sourceBytes,
            loadedBytes: (volumeData && volumeData.data && Number.isFinite(volumeData.data.byteLength))
                ? volumeData.data.byteLength
                : null
        });
        viewer.update3DResolutionOptions('full');
        viewer.applySmart3DResolutionDefault().catch((error) => {
            console.warn('Auto 3D resolution selection failed:', error);
        });

        if (viewer.histogram) {
            viewer.histogram.setVolume(volumeData);
        }

        viewer.status.updateVolumeUI({
            name: fileGroup.name || 'NIfTI',
            dimensions: info.dimensions,
            label: `NIfTI ${info.dataType}`
        });
        this.logFinalReady(fileGroup.name || 'NIfTI', startMs, 'direct');

        viewer.status.hideLoadingIndicator();
    }

    async loadProgressive(fileGroup, volumeData, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        viewer.switchToCTMode();
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();

        let progressiveData = null;
        const name = fileGroup.name || 'NIfTI';
        const orientationInfo = volumeData && volumeData.metadata
            ? volumeData.metadata.niftiOrientation || null
            : null;
        const metadata = {
            dimensions: volumeData.dimensions,
            dataType: volumeData.dataType,
            spacing: volumeData.spacing,
            niftiOrientation: orientationInfo
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
                    name,
                    dimensions: progData.dimensions,
                    dataType: progData.dataType,
                    isStreaming: !!progData.isStreaming,
                    hasFullData: false,
                    lowResVolume,
                    orientationInfo,
                    sourceBytes,
                    loadedBytes: (lowResVolume && lowResVolume.data && Number.isFinite(lowResVolume.data.byteLength))
                        ? lowResVolume.data.byteLength
                        : null
                });
                viewer.status.updateVolumeUI({
                    name,
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
                this.logPreviewReady(name, startMs, `low=${lowResVolume.dimensions.join('x')}`);
            },
            onBlockReady: (blockIndex, zStart, zEnd) => {
                viewer.ctViewer.handleBlockReady(blockIndex, zStart, zEnd);
            },
            onAllBlocksReady: () => {
                viewer.updateVolumeState({
                    name,
                    dimensions: progressiveData.dimensions,
                    dataType: progressiveData.dataType,
                    isStreaming: false,
                    hasFullData: true,
                    orientationInfo,
                    sourceBytes,
                    loadedBytes: (progressiveData && progressiveData.data && Number.isFinite(progressiveData.data.byteLength))
                        ? progressiveData.data.byteLength
                        : viewer.volumeState.loadedBytes
                });
                viewer.status.updateVolumeUI({
                    name,
                    dimensions: progressiveData.dimensions,
                    label: `NIfTI ${progressiveData.dataType}`
                });

                viewer.ctViewer.handleAllBlocksReady();
                viewer.update3DResolutionOptions();
                viewer.applySmart3DResolutionDefault().catch((error) => {
                    console.warn('Auto 3D resolution selection failed:', error);
                });
                this.logFinalReady(name, startMs, `full=${progressiveData.dimensions.join('x')}`);
            }
        };

        const loader = new ProgressiveVolumeLoader();
        await loader.loadProgressive(volumeData.data.buffer, metadata, callbacks);
    }
}

window.NiftiVolumeLoader = NiftiVolumeLoader;
