class DicomSeriesLoader {
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
        console.log(`[LoadTiming][DICOM] Preview ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    logFinalReady(name, startMs, details = '') {
        const elapsed = this.nowMs() - startMs;
        const suffix = details ? ` (${details})` : '';
        console.log(`[LoadTiming][DICOM] Final ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    async load(seriesGroup) {
        const viewer = this.viewer;
        const loadStartMs = this.nowMs();
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            viewer.status.showLoadingIndicator('Loading DICOM series...');

            const PROGRESSIVE_THRESHOLD = (typeof WebGLUtils !== 'undefined' &&
                typeof WebGLUtils.getVolumeProgressiveThresholdBytes === 'function')
                ? WebGLUtils.getVolumeProgressiveThresholdBytes()
                : 50 * 1024 * 1024;

            const sourceBytes = seriesGroup.files.reduce((total, file) => total + file.size, 0);
            const useProgressive = sourceBytes > PROGRESSIVE_THRESHOLD;

            if (useProgressive) {
                await this.loadProgressive(seriesGroup, sourceBytes, loadStartMs);
            } else {
                await this.loadDirect(seriesGroup, sourceBytes, loadStartMs);
            }
        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }

    async loadDirect(seriesGroup, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();
        const volumeData = await viewer.fileParser.loadDICOMSeries(
            seriesGroup,
            (progress) => {
                viewer.status.updateLoadingProgress(progress);
            }
        );
        const orientationInfo = volumeData && volumeData.metadata
            ? volumeData.metadata.dicomOrientation || null
            : null;

        viewer.switchToCTMode();

        const info = viewer.ctViewer.loadVolume(volumeData);
        viewer.updateVolumeState({
            name: seriesGroup.name || 'DICOM Series',
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
            name: seriesGroup.name || 'DICOM Series',
            dimensions: info.dimensions,
            label: `DICOM ${info.dataType}`
        });
        this.logFinalReady(seriesGroup.name || 'DICOM Series', startMs, 'direct');

        viewer.status.hideLoadingIndicator();
    }

    async loadProgressive(seriesGroup, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();
        viewer.switchToCTMode();

        let progressiveData = null;
        let orientationInfo = null;

        const callbacks = {
            onProgress: (progress) => {
                viewer.status.updateLoadingProgress(progress);
            },
            onLowResReady: (lowResVolume, progData) => {
                progressiveData = progData;
                orientationInfo = progData && progData.metadata
                    ? progData.metadata.dicomOrientation || null
                    : orientationInfo;
                viewer.ctViewer.progressiveVolume = progData;
                viewer.ctViewer.volumeData = progData;

                if (progData.isStreaming) {
                    progData.onSliceReady = (z) => {
                        const currentZ = viewer.ctViewer.state.slices.xy;
                        if (z === currentZ) {
                            viewer.ctViewer.renderView('xy', z);
                            if (viewer.ctViewer.crosshairEnabled) {
                                viewer.ctViewer.drawCrosshairs();
                            }
                        }
                    };

                    progData.onXZSliceReady = (y) => {
                        const currentY = viewer.ctViewer.state.slices.xz;
                        if (y === currentY) {
                            viewer.ctViewer.renderView('xz', y);
                            if (viewer.ctViewer.crosshairEnabled) {
                                viewer.ctViewer.drawCrosshairs();
                            }
                        }
                    };

                    progData.onYZSliceReady = (x) => {
                        const currentX = viewer.ctViewer.state.slices.yz;
                        if (x === currentX) {
                            viewer.ctViewer.renderView('yz', x);
                            if (viewer.ctViewer.crosshairEnabled) {
                                viewer.ctViewer.drawCrosshairs();
                            }
                        }
                    };
                }

                viewer.updateVolumeState({
                    name: seriesGroup.name || 'DICOM Series',
                    dimensions: progData.dimensions,
                    dataType: progData.dataType,
                    isStreaming: !!progData.isStreaming,
                    hasFullData: false,
                    lowResVolume: lowResVolume,
                    orientationInfo,
                    sourceBytes,
                    loadedBytes: (lowResVolume && lowResVolume.data && Number.isFinite(lowResVolume.data.byteLength))
                        ? lowResVolume.data.byteLength
                        : null
                });
                viewer.status.updateVolumeUI({
                    name: seriesGroup.name || 'DICOM Series',
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
                this.logPreviewReady(seriesGroup.name || 'DICOM Series', startMs, `low=${lowResVolume.dimensions.join('x')}`);
            },
            onBlockReady: (blockIndex, zStart, zEnd) => {
                viewer.ctViewer.handleBlockReady(blockIndex, zStart, zEnd);
            },
            onAllBlocksReady: () => {
                viewer.updateVolumeState({
                    name: seriesGroup.name || 'DICOM Series',
                    dimensions: progressiveData.dimensions,
                    dataType: progressiveData.dataType,
                    hasFullData: !viewer.volumeState.isStreaming,
                    orientationInfo,
                    sourceBytes,
                    loadedBytes: (!viewer.volumeState.isStreaming &&
                        progressiveData && progressiveData.data &&
                        Number.isFinite(progressiveData.data.byteLength))
                        ? progressiveData.data.byteLength
                        : viewer.volumeState.loadedBytes
                });
                viewer.status.updateVolumeUI({
                    name: seriesGroup.name || 'DICOM Series',
                    dimensions: progressiveData.dimensions,
                    label: `DICOM ${progressiveData.dataType}`
                });

                viewer.ctViewer.handleAllBlocksReady();
                viewer.update3DResolutionOptions();
                viewer.applySmart3DResolutionDefault().catch((error) => {
                    console.warn('Auto 3D resolution selection failed:', error);
                });
                this.logFinalReady(seriesGroup.name || 'DICOM Series', startMs, `full=${progressiveData.dimensions.join('x')}`);
            }
        };

        await viewer.fileParser.loadDICOMSeriesProgressive(seriesGroup, callbacks);
    }
}

window.DicomSeriesLoader = DicomSeriesLoader;
