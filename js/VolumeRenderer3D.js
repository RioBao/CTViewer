/**
 * 3D Volume Renderer
 * Manages camera, user interaction, and progressive rendering
 */
class VolumeRenderer3D {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Set canvas size to match display (will be updated dynamically)
        this.displaySize = 512;
        this.updateDisplaySize();

        // Raycaster
        this.raycaster = new MIPRaycaster();

        // Camera state
        this.camera = {
            azimuth: 30,      // Horizontal rotation (degrees)
            elevation: 20,    // Vertical rotation (degrees)
            distance: 1.0     // Zoom factor (1.0 = fit to viewport)
        };

        // Render quality settings
        this.qualityPresets = {
            low: { resolution: 64, stepSize: 2.0 },
            medium: { resolution: 128, stepSize: 1.0 },
            high: { resolution: 256, stepSize: 0.5 }
        };

        this.currentQuality = 'medium';
        this.interactionQuality = 'low';

        // Render settings
        this.settings = {
            stepSize: 1.0,
            threshold: 0
        };

        // Render buffers
        this.renderResolution = 128;
        this.imageData = null;
        this.offscreenCanvas = null;
        this.offscreenCtx = null;

        // Interaction state
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };

        // Progressive rendering
        this.refineTimer = null;
        this.isRendering = false;

        // Volume loaded flag
        this.volumeLoaded = false;

        this.initRenderBuffers();
        this.setupEventListeners();
        this.drawPlaceholder();
    }

    /**
     * Initialize offscreen render buffers
     */
    initRenderBuffers() {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }

    /**
     * Set up mouse/touch event listeners
     */
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));

        // Wheel for zoom
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));

        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }

    /**
     * Update display size based on container dimensions
     */
    updateDisplaySize() {
        const container = this.canvas.parentElement;
        const maxSize = 2048;

        if (container) {
            const rect = container.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            // Use the smaller dimension to maintain square aspect for 3D view
            const size = Math.min(rect.width, rect.height);
            this.displaySize = Math.min(Math.floor(size * dpr), maxSize);
        }

        if (this.canvas.width !== this.displaySize || this.canvas.height !== this.displaySize) {
            this.canvas.width = this.displaySize;
            this.canvas.height = this.displaySize;
        }
    }

    /**
     * Load volume data for rendering
     */
    loadVolume(volumeData) {
        this.raycaster.setVolume(volumeData);
        this.volumeLoaded = true;

        // Reset camera to default view
        this.camera.azimuth = 30;
        this.camera.elevation = 20;
        this.camera.distance = 1.0;

        // Initial render at medium quality
        this.renderAtQuality('medium');
    }

    /**
     * Draw placeholder when no volume is loaded
     */
    drawPlaceholder() {
        this.updateDisplaySize();
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.displaySize, this.displaySize);

        this.ctx.fillStyle = '#666';
        this.ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('3D Rendering', this.displaySize / 2, this.displaySize / 2 - 10);

        this.ctx.fillStyle = '#555';
        this.ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.fillText('Load a volume to view', this.displaySize / 2, this.displaySize / 2 + 15);
    }

    /**
     * Render at specified quality level
     */
    renderAtQuality(quality) {
        if (!this.volumeLoaded) return;

        const preset = this.qualityPresets[quality] || this.qualityPresets.medium;
        this.renderResolution = preset.resolution;
        this.settings.stepSize = preset.stepSize;

        this.render();
    }

    /**
     * Main render function
     */
    render() {
        if (!this.volumeLoaded || this.isRendering) return;

        this.isRendering = true;

        // Update canvas size based on container
        this.updateDisplaySize();

        // Set up offscreen canvas at render resolution
        this.offscreenCanvas.width = this.renderResolution;
        this.offscreenCanvas.height = this.renderResolution;

        // Create ImageData for raycaster output
        this.imageData = this.offscreenCtx.createImageData(
            this.renderResolution,
            this.renderResolution
        );

        // Perform raycasting
        this.raycaster.render(this.imageData, this.camera, this.settings);

        // Put rendered image to offscreen canvas
        this.offscreenCtx.putImageData(this.imageData, 0, 0);

        // Scale up to display canvas with smoothing disabled for crisp pixels
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.fillStyle = '#0a0a0a';
        this.ctx.fillRect(0, 0, this.displaySize, this.displaySize);
        this.ctx.drawImage(
            this.offscreenCanvas,
            0, 0, this.renderResolution, this.renderResolution,
            0, 0, this.displaySize, this.displaySize
        );

        // Draw label
        this.drawLabel();

        this.isRendering = false;
    }

    /**
     * Draw view label on canvas
     */
    drawLabel() {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(8, 8, 50, 22);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillText('3D', 16, 23);
    }

    // ===== Mouse Interaction =====

    handleMouseDown(e) {
        if (!this.volumeLoaded) return;

        this.isDragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';

        // Switch to low quality during interaction
        this.startInteraction();
    }

    handleMouseMove(e) {
        if (!this.isDragging) return;

        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;

        // Update camera angles
        this.camera.azimuth += dx * 0.5;
        this.camera.elevation += dy * 0.5;

        // Clamp elevation to avoid gimbal lock
        this.camera.elevation = Math.max(-89, Math.min(89, this.camera.elevation));

        // Normalize azimuth
        this.camera.azimuth = this.camera.azimuth % 360;

        this.lastMouse = { x: e.clientX, y: e.clientY };

        // Render at interaction quality
        this.render();
    }

    handleMouseUp(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.canvas.style.cursor = 'grab';

        // Schedule high quality render
        this.endInteraction();
    }

    handleWheel(e) {
        if (!this.volumeLoaded) return;

        e.preventDefault();

        // Adjust zoom
        const delta = e.deltaY > 0 ? 0.1 : -0.1;
        this.camera.distance = Math.max(0.5, Math.min(3.0, this.camera.distance + delta));

        // Start interaction for immediate feedback
        this.startInteraction();
        this.render();

        // Schedule refinement
        this.endInteraction();
    }

    // ===== Touch Interaction =====

    handleTouchStart(e) {
        if (!this.volumeLoaded || e.touches.length !== 1) return;

        e.preventDefault();
        const touch = e.touches[0];
        this.isDragging = true;
        this.lastMouse = { x: touch.clientX, y: touch.clientY };
        this.startInteraction();
    }

    handleTouchMove(e) {
        if (!this.isDragging || e.touches.length !== 1) return;

        e.preventDefault();
        const touch = e.touches[0];

        const dx = touch.clientX - this.lastMouse.x;
        const dy = touch.clientY - this.lastMouse.y;

        this.camera.azimuth += dx * 0.5;
        this.camera.elevation += dy * 0.5;
        this.camera.elevation = Math.max(-89, Math.min(89, this.camera.elevation));
        this.camera.azimuth = this.camera.azimuth % 360;

        this.lastMouse = { x: touch.clientX, y: touch.clientY };
        this.render();
    }

    handleTouchEnd(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.endInteraction();
    }

    // ===== Progressive Rendering =====

    startInteraction() {
        // Cancel pending refinement
        if (this.refineTimer) {
            clearTimeout(this.refineTimer);
            this.refineTimer = null;
        }

        // Switch to low quality
        const preset = this.qualityPresets[this.interactionQuality];
        this.renderResolution = preset.resolution;
        this.settings.stepSize = preset.stepSize;
    }

    endInteraction() {
        // Schedule high quality render after brief delay
        if (this.refineTimer) {
            clearTimeout(this.refineTimer);
        }

        this.refineTimer = setTimeout(() => {
            this.renderAtQuality(this.currentQuality);
            this.refineTimer = null;
        }, 150);
    }

    // ===== Public API =====

    /**
     * Set render quality
     * @param {string} quality - 'low', 'medium', or 'high'
     */
    setQuality(quality) {
        if (this.qualityPresets[quality]) {
            this.currentQuality = quality;
            this.renderAtQuality(quality);
        }
    }

    /**
     * Set MIP threshold (minimum value to display)
     * @param {number} threshold - Threshold value in data range
     */
    setThreshold(threshold) {
        this.settings.threshold = threshold;
        this.render();
    }

    /**
     * Set display range for windowing
     * Values below min map to 0, values at/above max map to 1
     * @param {number} min - Low value
     * @param {number} max - High value
     */
    setDisplayRange(min, max) {
        this.raycaster.setDisplayRange(min, max);
        this.renderAtQuality(this.currentQuality);
    }

    /**
     * Set gamma correction
     * @param {number} gamma - Gamma value (1.0 = no change, <1 = brighten, >1 = darken)
     */
    setGamma(gamma) {
        this.raycaster.setGamma(gamma);
        this.renderAtQuality(this.currentQuality);
    }

    /**
     * Reset camera to default view
     */
    resetCamera() {
        this.camera.azimuth = 30;
        this.camera.elevation = 20;
        this.camera.distance = 1.0;
        this.renderAtQuality(this.currentQuality);
    }

    /**
     * Get current camera state
     */
    getCamera() {
        return { ...this.camera };
    }

    /**
     * Set camera state
     */
    setCamera(camera) {
        Object.assign(this.camera, camera);
        this.renderAtQuality(this.currentQuality);
    }
}
