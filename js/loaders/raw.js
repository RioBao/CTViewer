class RawVolumeLoader {
    constructor(viewer) {
        this.viewer = viewer;
    }

    async load(fileGroup) {
        const viewer = this.viewer;
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            viewer.status.showLoadingIndicator('Loading 3D volume...');

            const PROGRESSIVE_THRESHOLD = (typeof ViewerConfig !== 'undefined' &&
                ViewerConfig.limits &&
                Number.isFinite(ViewerConfig.limits.progressiveThresholdBytes))
                ? ViewerConfig.limits.progressiveThresholdBytes
                : 50 * 1024 * 1024;

            const useProgressive = fileGroup.rawFile.size > PROGRESSIVE_THRESHOLD;

            if (useProgressive) {
                await this.loadProgressive(fileGroup);
            } else {
                await this.loadDirect(fileGroup);
            }

        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }

    async loadDirect(fileGroup) {
        const viewer = this.viewer;
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
            lowResVolume: null
        });
        viewer.update3DResolutionOptions('full');

        if (viewer.histogram) {
            viewer.histogram.setVolume(volumeData);
        }

        viewer.status.updateVolumeUI({
            name: fileGroup.name,
            dimensions: info.dimensions,
            label: info.dataType
        });

        viewer.status.hideLoadingIndicator();
    }

    async loadProgressive(fileGroup) {
        const viewer = this.viewer;
        console.log('Using progressive loading for large volume');

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
                    lowResVolume: lowResVolume
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
                    isStreaming: false
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
                    hasFullData: !viewer.volumeState.isStreaming
                });
                viewer.status.updateVolumeUI({
                    name: fileGroup.name,
                    dimensions: progressiveData.dimensions,
                    label: progressiveData.dataType
                });

                viewer.ctViewer.handleAllBlocksReady();

                viewer.update3DResolutionOptions();

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
