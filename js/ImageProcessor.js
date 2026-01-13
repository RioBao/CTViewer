class ImageProcessor {
    constructor() {
        // Window/Level presets for medical imaging
        this.presets = {
            'default': { center: 128, width: 256 },
            'lung': { center: -600, width: 1500 },
            'bone': { center: 300, width: 2000 },
            'soft-tissue': { center: 40, width: 400 },
            'brain': { center: 40, width: 80 },
            'liver': { center: 30, width: 150 }
        };

        this.currentPreset = 'default';
    }

    /**
     * Apply contrast and brightness to a pixel value
     * @param {number} value - Pixel value (0-255)
     * @param {number} contrast - Contrast factor (0.5 - 2.0)
     * @param {number} brightness - Brightness offset (-100 to +100)
     * @returns {number} Adjusted pixel value (0-255)
     */
    applyContrastBrightness(value, contrast, brightness) {
        // Apply contrast around midpoint (128)
        let adjusted = (value - 128) * contrast + 128;

        // Apply brightness
        adjusted += brightness;

        // Clamp to valid range
        return Math.max(0, Math.min(255, adjusted));
    }

    /**
     * Apply window/level adjustment (medical imaging standard)
     * @param {number} pixelValue - Original pixel value (in original data range)
     * @param {number} center - Window center (level)
     * @param {number} width - Window width
     * @returns {number} Display value (0-255)
     */
    applyWindowLevel(pixelValue, center, width) {
        const min = center - width / 2;
        const max = center + width / 2;

        if (pixelValue <= min) return 0;
        if (pixelValue >= max) return 255;

        // Linear mapping within window
        return Math.round(((pixelValue - min) / width) * 255);
    }

    /**
     * Get a preset window/level configuration
     * @param {string} presetName - Name of the preset
     * @returns {object} { center, width }
     */
    getPreset(presetName) {
        return this.presets[presetName] || this.presets['default'];
    }

    /**
     * Get all available presets
     * @returns {object} Map of preset names to configurations
     */
    getAllPresets() {
        return { ...this.presets };
    }

    /**
     * Set current preset
     */
    setPreset(presetName) {
        if (this.presets[presetName]) {
            this.currentPreset = presetName;
            return this.presets[presetName];
        }
        return null;
    }

    /**
     * Add or update a custom preset
     */
    addCustomPreset(name, center, width) {
        this.presets[name] = { center, width };
    }

    /**
     * Normalize value from original data range to 0-255
     * @param {number} value - Original value
     * @param {number} min - Minimum value in dataset
     * @param {number} max - Maximum value in dataset
     * @returns {number} Normalized value (0-255)
     */
    normalize(value, min, max) {
        if (max === min) return 128;
        const normalized = ((value - min) / (max - min)) * 255;
        return Math.max(0, Math.min(255, normalized));
    }

    /**
     * Apply histogram equalization (for future enhancement)
     * @param {Array} histogram - Histogram data
     * @returns {Array} Lookup table for equalization
     */
    histogramEqualization(histogram) {
        const totalPixels = histogram.reduce((sum, val) => sum + val, 0);
        const lut = new Array(256);
        let cumulative = 0;

        for (let i = 0; i < 256; i++) {
            cumulative += histogram[i];
            lut[i] = Math.round((cumulative / totalPixels) * 255);
        }

        return lut;
    }

    /**
     * Calculate histogram from image data
     * @param {TypedArray} data - Image data
     * @param {number} min - Data minimum
     * @param {number} max - Data maximum
     * @returns {Array} Histogram (256 bins)
     */
    calculateHistogram(data, min, max) {
        const histogram = new Array(256).fill(0);
        const range = max - min;

        for (let i = 0; i < data.length; i++) {
            const normalized = Math.floor(((data[i] - min) / range) * 255);
            const bin = Math.max(0, Math.min(255, normalized));
            histogram[bin]++;
        }

        return histogram;
    }

    /**
     * Get processing info
     */
    getInfo() {
        return {
            currentPreset: this.currentPreset,
            presetConfig: this.presets[this.currentPreset],
            availablePresets: Object.keys(this.presets)
        };
    }
}
