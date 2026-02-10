class DicomSeriesLoader {
    constructor(viewer) {
        this.viewer = viewer;
    }

    async load(seriesGroup) {
        const viewer = this.viewer;
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            viewer.status.showLoadingIndicator('Loading DICOM series...');

            const volumeData = await viewer.fileParser.loadDICOMSeries(
                seriesGroup,
                (progress) => {
                    viewer.status.updateLoadingProgress(progress);
                }
            );

            viewer.switchToCTMode();

            const info = viewer.ctViewer.loadVolume(volumeData);
            viewer.updateVolumeState({
                name: seriesGroup.name || 'DICOM Series',
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
                name: seriesGroup.name || 'DICOM Series',
                dimensions: info.dimensions,
                label: `DICOM ${info.dataType}`
            });

            viewer.status.hideLoadingIndicator();
        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }
}

window.DicomSeriesLoader = DicomSeriesLoader;
