class SliceRenderer {
    constructor(canvas, label) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.label = label;

        this.currentSliceData = null;
        this.currentWidth = 0;
        this.currentHeight = 0;

        // Rendering parameters
        this.zoom = 1.0;
        this.pan = { x: 0, y: 0 };
        this.contrast = 1.0;
        this.brightness = 0;

        // Data range for normalization
        this.dataMin = 0;
        this.dataMax = 255;
    }

    /**
     * Set the data range for normalization
     */
    setDataRange(min, max) {
        this.dataMin = min;
        this.dataMax = max;
    }

    /**
     * Update rendering parameters
     */
    updateParameters(params) {
        if (params.zoom !== undefined) this.zoom = params.zoom;
        if (params.pan !== undefined) this.pan = params.pan;
        if (params.contrast !== undefined) this.contrast = params.contrast;
        if (params.brightness !== undefined) this.brightness = params.brightness;
    }

    /**
     * Render a slice to the canvas
     * @param {object} sliceData - { data: TypedArray, width: number, height: number }
     * @param {object} imageProcessor - ImageProcessor instance for applying effects
     */
    render(sliceData, imageProcessor) {
        if (!sliceData || !sliceData.data) {
            this.clearCanvas();
            return;
        }

        this.currentSliceData = sliceData;
        this.currentWidth = sliceData.width;
        this.currentHeight = sliceData.height;

        // Set canvas to a reasonable display size (512x512 default)
        // We'll scale the image to fit within this
        const displaySize = 512;
        if (this.canvas.width !== displaySize || this.canvas.height !== displaySize) {
            this.canvas.width = displaySize;
            this.canvas.height = displaySize;
        }

        // Create ImageData
        const imageData = this.ctx.createImageData(sliceData.width, sliceData.height);

        // Convert slice data to RGBA
        this.sliceDataToImageData(sliceData.data, imageData, imageProcessor);

        // Create a temporary canvas to hold the ImageData
        // We need this because putImageData ignores transforms
        if (!this.tempCanvas) {
            this.tempCanvas = document.createElement('canvas');
        }
        this.tempCanvas.width = sliceData.width;
        this.tempCanvas.height = sliceData.height;
        const tempCtx = this.tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        // Clear and draw with transforms
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Calculate scale to fit image in canvas (maintaining aspect ratio)
        const scaleX = this.canvas.width / sliceData.width;
        const scaleY = this.canvas.height / sliceData.height;
        const baseScale = Math.min(scaleX, scaleY);

        // Calculate centered position
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Calculate scaled dimensions
        const scaledWidth = sliceData.width * baseScale;
        const scaledHeight = sliceData.height * baseScale;

        // Apply transforms: translate to center, apply zoom and pan, translate back
        this.ctx.translate(centerX + this.pan.x, centerY + this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(-scaledWidth / 2, -scaledHeight / 2);

        // Draw the image with base scaling (this respects transforms)
        this.ctx.drawImage(this.tempCanvas, 0, 0, sliceData.width, sliceData.height,
                          0, 0, scaledWidth, scaledHeight);

        this.ctx.restore();

        // Draw label
        this.drawLabel();
    }

    /**
     * Convert slice data to ImageData with normalization and processing
     */
    sliceDataToImageData(sliceData, imageData, imageProcessor) {
        const pixels = imageData.data;
        const range = this.dataMax - this.dataMin;

        for (let i = 0; i < sliceData.length; i++) {
            // Normalize to 0-255
            let value = sliceData[i];
            let normalized = ((value - this.dataMin) / range) * 255;
            normalized = Math.max(0, Math.min(255, normalized));

            // Apply contrast and brightness
            if (imageProcessor) {
                normalized = imageProcessor.applyContrastBrightness(
                    normalized,
                    this.contrast,
                    this.brightness
                );
            }

            const pixelIndex = i * 4;
            pixels[pixelIndex] = normalized;     // R
            pixels[pixelIndex + 1] = normalized; // G
            pixels[pixelIndex + 2] = normalized; // B
            pixels[pixelIndex + 3] = 255;        // A
        }
    }

    /**
     * Draw view label on canvas
     */
    drawLabel() {
        if (!this.label) return;

        this.ctx.save();
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        this.ctx.lineWidth = 3;

        const text = this.label;
        const x = 10;
        const y = 25;

        // Draw text with outline
        this.ctx.strokeText(text, x, y);
        this.ctx.fillText(text, x, y);

        this.ctx.restore();
    }

    /**
     * Clear the canvas
     */
    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Convert canvas coordinates to image coordinates
     */
    canvasToImageCoords(canvasX, canvasY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (canvasX - rect.left - this.pan.x) / this.zoom;
        const y = (canvasY - rect.top - this.pan.y) / this.zoom;
        return { x: Math.floor(x), y: Math.floor(y) };
    }

    /**
     * Get pixel value at canvas coordinates
     */
    getValueAtCanvasCoords(canvasX, canvasY) {
        if (!this.currentSliceData) return null;

        const { x, y } = this.canvasToImageCoords(canvasX, canvasY);

        if (x < 0 || x >= this.currentWidth || y < 0 || y >= this.currentHeight) {
            return null;
        }

        const index = y * this.currentWidth + x;
        return this.currentSliceData.data[index];
    }

    /**
     * Get rendering info
     */
    getInfo() {
        return {
            label: this.label,
            dimensions: `${this.currentWidth} × ${this.currentHeight}`,
            zoom: `${(this.zoom * 100).toFixed(0)}%`,
            pan: `${this.pan.x.toFixed(0)}, ${this.pan.y.toFixed(0)}`
        };
    }
}
