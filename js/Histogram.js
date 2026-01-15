class Histogram {
    constructor(canvas, handleMin, handleMax, minLabel, maxLabel) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.handleMin = handleMin;
        this.handleMax = handleMax;
        this.minLabel = minLabel;
        this.maxLabel = maxLabel;

        this.histogramData = null;  // 256-bin array
        this.volumeMin = 0;
        this.volumeMax = 255;
        this.currentMin = 0;
        this.currentMax = 255;

        this.imageProcessor = new ImageProcessor();
        this.onRangeChange = null;  // callback for when user drags handles

        this.isDragging = false;
        this.activeHandle = null;

        // Set up canvas resolution to match display size
        this.setupCanvas();

        this.initDragHandlers();

        // Draw initial empty state
        this.renderEmpty();
    }

    /**
     * Set up canvas resolution to match CSS size
     */
    setupCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Use getBoundingClientRect if available, otherwise fall back to container or defaults
        let width = rect.width;
        let height = rect.height;

        if (width <= 0 || height <= 0) {
            // Fallback to parent container dimensions
            const container = this.canvas.parentElement;
            if (container) {
                width = container.offsetWidth || 220;
                height = container.offsetHeight || 100;
            } else {
                width = 220;
                height = 100;
            }
        }

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        // Reset transform before scaling (setting canvas.width already resets, but be explicit)
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
        this.displayWidth = width;
        this.displayHeight = height;
    }

    /**
     * Render empty state (before any volume is loaded)
     */
    renderEmpty() {
        const ctx = this.ctx;
        const width = this.displayWidth || this.canvas.width;
        const height = this.displayHeight || this.canvas.height;

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#444';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data loaded', width / 2, height / 2);
    }

    /**
     * Set volume data and calculate histogram
     */
    setVolume(volumeData) {
        this.volumeMin = volumeData.min;
        this.volumeMax = volumeData.max;
        this.currentMin = volumeData.min;
        this.currentMax = volumeData.max;

        // Re-setup canvas to ensure proper dimensions (may have been 0 during init)
        this.setupCanvas();

        // Calculate histogram from entire volume
        this.histogramData = this.imageProcessor.calculateHistogram(
            volumeData.data,
            volumeData.min,
            volumeData.max
        );

        this.render();
        this.updateHandles();
        this.updateLabels();
    }

    /**
     * Update the current display range (e.g., from ROI selection)
     */
    setRange(min, max) {
        this.currentMin = min;
        this.currentMax = max;
        this.render();
        this.updateHandles();
        this.updateLabels();
    }

    /**
     * Render the histogram visualization
     */
    render() {
        if (!this.histogramData) {
            this.renderEmpty();
            return;
        }

        const ctx = this.ctx;
        const width = this.displayWidth || this.canvas.width;
        const height = this.displayHeight || this.canvas.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // Find max bin value for scaling (use log scale for better visualization)
        let maxCount = 0;
        for (let i = 0; i < this.histogramData.length; i++) {
            if (this.histogramData[i] > maxCount) {
                maxCount = this.histogramData[i];
            }
        }

        if (maxCount === 0) return;

        // Use logarithmic scale for better visibility of small values
        const logMax = Math.log(maxCount + 1);

        // Calculate which bins are in the active range
        const range = this.volumeMax - this.volumeMin;
        const minBin = range > 0 ? Math.floor(((this.currentMin - this.volumeMin) / range) * 255) : 0;
        const maxBin = range > 0 ? Math.floor(((this.currentMax - this.volumeMin) / range) * 255) : 255;

        // Draw histogram bars
        const barWidth = width / 256;

        for (let i = 0; i < 256; i++) {
            const count = this.histogramData[i];
            const logCount = Math.log(count + 1);
            const barHeight = (logCount / logMax) * height;

            const x = i * barWidth;
            const y = height - barHeight;

            // Color bars based on whether they're in the active range
            if (i >= minBin && i <= maxBin) {
                ctx.fillStyle = '#4a9eff';  // Active range - blue
            } else {
                ctx.fillStyle = '#3a3a3a';  // Outside range - dark gray
            }

            ctx.fillRect(x, y, Math.max(barWidth, 1), barHeight);
        }

        // Draw range boundary lines
        const minX = (minBin / 255) * width;
        const maxX = (maxBin / 255) * width;

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;

        // Min line
        ctx.beginPath();
        ctx.moveTo(minX, 0);
        ctx.lineTo(minX, height);
        ctx.stroke();

        // Max line
        ctx.beginPath();
        ctx.moveTo(maxX, 0);
        ctx.lineTo(maxX, height);
        ctx.stroke();
    }

    /**
     * Update handle positions based on current min/max values
     */
    updateHandles() {
        if (!this.handleMin || !this.handleMax) return;

        const containerWidth = this.displayWidth || this.canvas.parentElement.offsetWidth;
        const range = this.volumeMax - this.volumeMin;

        if (range <= 0) {
            this.handleMin.style.left = '0px';
            this.handleMax.style.left = (containerWidth - 10) + 'px';
            return;
        }

        const minPos = ((this.currentMin - this.volumeMin) / range) * containerWidth;
        const maxPos = ((this.currentMax - this.volumeMin) / range) * containerWidth;

        // Position handles at the range boundaries (handle width is 10px)
        this.handleMin.style.left = Math.max(0, minPos - 5) + 'px';
        this.handleMax.style.left = Math.min(containerWidth - 10, maxPos - 5) + 'px';
    }

    /**
     * Update the min/max value labels
     */
    updateLabels() {
        if (this.minLabel) {
            this.minLabel.textContent = Math.round(this.currentMin);
        }
        if (this.maxLabel) {
            this.maxLabel.textContent = Math.round(this.currentMax);
        }
    }

    /**
     * Initialize drag handlers for the min/max handles
     */
    initDragHandlers() {
        if (!this.handleMin || !this.handleMax) return;

        // Min handle
        this.handleMin.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isDragging = true;
            this.activeHandle = 'min';
        });

        // Max handle
        this.handleMax.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isDragging = true;
            this.activeHandle = 'max';
        });

        // Document-level mouse events for dragging
        document.addEventListener('mousemove', (e) => this.handleDrag(e));
        document.addEventListener('mouseup', () => this.handleDragEnd());
    }

    /**
     * Handle drag movement
     */
    handleDrag(e) {
        if (!this.isDragging || !this.activeHandle) return;

        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const containerWidth = rect.width;

        // Convert pixel position to value
        const ratio = Math.max(0, Math.min(1, x / containerWidth));
        const range = this.volumeMax - this.volumeMin;
        const value = this.volumeMin + ratio * range;

        // Update the appropriate bound
        if (this.activeHandle === 'min') {
            // Min can't exceed max - 1
            this.currentMin = Math.min(value, this.currentMax - 1);
            this.currentMin = Math.max(this.volumeMin, this.currentMin);
        } else {
            // Max can't go below min + 1
            this.currentMax = Math.max(value, this.currentMin + 1);
            this.currentMax = Math.min(this.volumeMax, this.currentMax);
        }

        // Update visualization
        this.render();
        this.updateHandles();
        this.updateLabels();

        // Notify listeners
        if (this.onRangeChange) {
            this.onRangeChange(this.currentMin, this.currentMax);
        }
    }

    /**
     * Handle drag end
     */
    handleDragEnd() {
        this.isDragging = false;
        this.activeHandle = null;
    }

    /**
     * Reset to full volume range
     */
    reset() {
        this.currentMin = this.volumeMin;
        this.currentMax = this.volumeMax;
        this.render();
        this.updateHandles();
        this.updateLabels();
    }
}
