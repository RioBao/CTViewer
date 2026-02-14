class RawVolumeLoader {
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
        console.log(`[LoadTiming][RAW] Preview ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    logFinalReady(name, startMs, details = '') {
        const elapsed = this.nowMs() - startMs;
        const suffix = details ? ` (${details})` : '';
        console.log(`[LoadTiming][RAW] Final ready for "${name}" in ${this.formatSeconds(elapsed)}${suffix}`);
    }

    async load(fileGroup) {
        const viewer = this.viewer;
        const loadStartMs = this.nowMs();
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            viewer.status.showLoadingIndicator('Loading 3D volume...');

            const PROGRESSIVE_THRESHOLD = (typeof WebGLUtils !== 'undefined' &&
                typeof WebGLUtils.getVolumeProgressiveThresholdBytes === 'function')
                ? WebGLUtils.getVolumeProgressiveThresholdBytes()
                : 50 * 1024 * 1024;
            const sourceBytes = Number.isFinite(fileGroup.rawFile && fileGroup.rawFile.size)
                ? fileGroup.rawFile.size
                : null;

            const useProgressive = fileGroup.rawFile.size > PROGRESSIVE_THRESHOLD;

            if (useProgressive) {
                await this.loadProgressive(fileGroup, sourceBytes, loadStartMs);
            } else {
                await this.loadDirect(fileGroup, sourceBytes, loadStartMs);
            }

        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }

    async loadDirect(fileGroup, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();
        const volumeData = await viewer.fileParser.load3DVolume(
            fileGroup.rawFile,
            fileGroup.jsonFile,
            (progress) => {
                viewer.status.updateLoadingProgress(progress);
            },
            fileGroup.volumeinfoFile,
            fileGroup.datFile
        );

        viewer.switchToCTMode();

        const info = viewer.ctViewer.loadVolume(volumeData);

        viewer.updateVolumeState({
            name: fileGroup.name,
            dimensions: info.dimensions,
            dataType: info.dataType,
            isStreaming: false,
            hasFullData: true,
            lowResVolume: null,
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
            name: fileGroup.name,
            dimensions: info.dimensions,
            label: info.dataType
        });
        this.logFinalReady(fileGroup.name, startMs, 'direct');

        viewer.status.hideLoadingIndicator();
    }

    async loadProgressive(fileGroup, sourceBytes = null, loadStartMs = null) {
        const viewer = this.viewer;
        console.log('Using progressive loading for large volume');
        const startMs = Number.isFinite(loadStartMs) ? loadStartMs : this.nowMs();

        viewer.switchToCTMode();

        let progressiveData = null;

        const callbacks = {
            onProgress: (progress) => {
                viewer.status.updateLoadingProgress(progress);
            },
            onLowResReady: (lowResVolume, progData) => {
                progressiveData = progData;
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
                    name: fileGroup.name,
                    dimensions: progData.dimensions,
                    dataType: progData.dataType,
                    isStreaming: !!progData.isStreaming,
                    hasFullData: false,
                    lowResVolume: lowResVolume,
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
            onFullDataReady: (newVolumeData) => {
                progressiveData = newVolumeData;
                viewer.ctViewer.progressiveVolume = newVolumeData;
                viewer.ctViewer.volumeData = newVolumeData;
                viewer.updateVolumeState({
                    hasFullData: true,
                    isStreaming: false,
                    sourceBytes,
                    loadedBytes: (newVolumeData && newVolumeData.data && Number.isFinite(newVolumeData.data.byteLength))
                        ? newVolumeData.data.byteLength
                        : viewer.volumeState.loadedBytes
                });

                const schedule = (cb) => {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(cb);
                    } else {
                        setTimeout(cb, 0);
                    }
                };

                viewer.ctViewer.renderView('xy');

                if (!viewer.ctViewer.singleViewMode) {
                    schedule(() => {
                        viewer.ctViewer.renderView('xz');
                        schedule(() => {
                            viewer.ctViewer.renderView('yz');
                            if (viewer.ctViewer.crosshairEnabled) {
                                viewer.ctViewer.drawCrosshairs();
                            }
                        });
                    });
                } else if (viewer.ctViewer.crosshairEnabled) {
                    viewer.ctViewer.drawCrosshairs();
                }

                // Skip histogram update - low-res histogram is already adequate.
                console.log('Hybrid mode: Swapped to in-memory volume data');
            },
            onAllBlocksReady: () => {
                viewer.updateVolumeState({
                    name: fileGroup.name,
                    dimensions: progressiveData.dimensions,
                    dataType: progressiveData.dataType,
                    hasFullData: !viewer.volumeState.isStreaming,
                    sourceBytes,
                    loadedBytes: (!viewer.volumeState.isStreaming &&
                        progressiveData && progressiveData.data &&
                        Number.isFinite(progressiveData.data.byteLength))
                        ? progressiveData.data.byteLength
                        : viewer.volumeState.loadedBytes
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

                console.log('Progressive loading complete');
            }
        };

        await viewer.fileParser.load3DVolumeProgressive(
            fileGroup.rawFile,
            fileGroup.jsonFile,
            callbacks,
            fileGroup.volumeinfoFile,
            fileGroup.datFile
        );
    }
}

window.RawVolumeLoader = RawVolumeLoader;
