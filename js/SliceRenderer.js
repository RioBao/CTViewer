class SliceRenderer {
    constructor(canvas, label) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.label = label;

        this.currentSliceData = null;
        this.currentWidth = 0;
        this.currentHeight = 0;
        this.isLowRes = false;

        // Rendering parameters
        this.zoom = 1.0;
        this.pan = { x: 0, y: 0 };
        this.contrast = 1.0;
        this.brightness = 0;

        // Data range for normalization
        this.dataMin = 0;
        this.dataMax = 255;

        // Cached temp canvas for GPU-friendly rendering
        // Only recreate when slice dimensions change
        this.tempCanvas = null;
        this.tempCtx = null;
        this.tempCanvasWidth = 0;
        this.tempCanvasHeight = 0;

        // Cached ImageData to avoid reallocations
        this.cachedImageData = null;
        this.cachedImageDataWidth = 0;
        this.cachedImageDataHeight = 0;

        // Track last canvas dimensions to avoid unnecessary resizes
        this.lastDisplayWidth = 0;
        this.lastDisplayHeight = 0;
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
        this.isLowRes = !!sliceData.isLowRes;

        // Size canvas based on container dimensions for best quality
        // Use container size but cap at a reasonable max for performance
        const container = this.canvas.parentElement;
        const maxSize = 2048;
        let displayWidth = 512;
        let displayHeight = 512;

        if (container) {
            const rect = container.getBoundingClientRect();
            // Use device pixel ratio for crisp rendering on high-DPI displays
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            displayWidth = Math.min(Math.floor(rect.width * dpr), maxSize);
            displayHeight = Math.min(Math.floor(rect.height * dpr), maxSize);
        }

        // Only resize main canvas when dimensions actually change
        // This avoids GPU texture reallocation on every frame
        if (this.lastDisplayWidth !== displayWidth || this.lastDisplayHeight !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
            this.lastDisplayWidth = displayWidth;
            this.lastDisplayHeight = displayHeight;
        }

        // Reuse or create ImageData - only reallocate when slice dimensions change
        if (this.cachedImageDataWidth !== sliceData.width ||
            this.cachedImageDataHeight !== sliceData.height) {
            try {
                this.cachedImageData = this.ctx.createImageData(sliceData.width, sliceData.height);
                this.cachedImageDataWidth = sliceData.width;
                this.cachedImageDataHeight = sliceData.height;
            } catch (e) {
                console.error('Failed to create ImageData:', e);
                return;
            }
        }

        // Convert slice data to RGBA (reuses cached ImageData)
        this.sliceDataToImageData(sliceData.data, this.cachedImageData, imageProcessor);

        // Reuse temp canvas - only resize when slice dimensions change
        // This prevents GPU texture reallocation on every frame
        if (!this.tempCanvas) {
            this.tempCanvas = document.createElement('canvas');
            this.tempCtx = null;
        }

        if (this.tempCanvasWidth !== sliceData.width || this.tempCanvasHeight !== sliceData.height) {
            this.tempCanvas.width = sliceData.width;
            this.tempCanvas.height = sliceData.height;
            this.tempCanvasWidth = sliceData.width;
            this.tempCanvasHeight = sliceData.height;
            // Force new context after resize
            this.tempCtx = null;
        }

        // Cache the temp context to avoid repeated getContext calls
        if (!this.tempCtx) {
            this.tempCtx = this.tempCanvas.getContext('2d');
        }

        // Wrap GPU operations in try/catch
        try {
            this.tempCtx.putImageData(this.cachedImageData, 0, 0);

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

            // Draw label and resolution indicator
            this.drawLabel();
            if (this.isLowRes) {
                this.drawResolutionIndicator();
            }
        } catch (e) {
            console.error('Canvas rendering error (possible GPU issue):', e);
            // Attempt recovery by clearing and showing error
            try {
                this.ctx.restore();
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillStyle = '#f00';
                this.ctx.font = '14px sans-serif';
                this.ctx.fillText('Render error - try disabling GPU acceleration', 10, 30);
            } catch (e2) {
                // Context completely dead
            }
        }
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
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        this.ctx.lineWidth = 2.5;

        const text = this.label;
        const x = 10;
        const y = 25;

        // Draw text with outline
        this.ctx.strokeText(text, x, y);
        this.ctx.fillText(text, x, y);

        this.ctx.restore();
    }

    /**
     * Draw a small resolution indicator in the bottom-right corner
     */
    drawResolutionIndicator() {
        try {
            this.ctx.save();

            const text = 'LOW RES';
            const font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            this.ctx.font = font;
            const metrics = this.ctx.measureText(text);
            const textW = metrics.width;
            const padX = 6;
            const padY = 4;
            const h = 18;
            const w = textW + padX * 2;
            const x = this.canvas.width - w - 8;
            const y = this.canvas.height - h - 8;

            // Background pill (muted amber to match 3D status chip)
            this.ctx.fillStyle = 'rgba(124, 99, 58, 0.74)';
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, w, h, 4);
            this.ctx.fill();

            // Text
            this.ctx.fillStyle = '#efe4d1';
            this.ctx.fillText(text, x + padX, y + h - padY - 1);

            this.ctx.restore();
        } catch (e) {
            // Silently ignore — roundRect not supported in very old browsers
        }
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
