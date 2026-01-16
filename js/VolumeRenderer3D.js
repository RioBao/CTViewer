/**
 * 3D Volume Renderer
 * Manages camera, user interaction, and progressive rendering
 * Uses WebGL2 when available, falls back to CPU rendering
 */
class VolumeRenderer3D {
    constructor(canvas) {
        this.canvas = canvas;

        // Try WebGL2 first
        this.gl = WebGLUtils.createContext(canvas);
        this.useWebGL = !!this.gl;

        if (this.useWebGL) {
            console.log('Using WebGL2 for 3D rendering');
            this.webglRenderer = new WebGLMIPRenderer(canvas, this.gl);
            this.setupContextLostHandlers();
        } else {
            console.log('WebGL2 not available, using CPU rendering');
            this.ctx = canvas.getContext('2d');
            this.raycaster = new MIPRaycaster();
            this.initRenderBuffers();
        }

        // Set canvas size to match display (will be updated dynamically)
        this.displaySize = 512;
        this.updateDisplaySize();

        // Volume reference for display range conversion
        this.volumeData = null;

        // Camera state
        this.camera = {
            azimuth: 30,      // Horizontal rotation (degrees)
            elevation: 20,    // Vertical rotation (degrees)
            distance: 1.0     // Zoom factor (1.0 = fit to viewport)
        };

        // Quality presets - WebGL can handle higher resolutions
        // Total ray length = numSteps * stepSize, needs to be >= 2.0 to traverse volume
        if (this.useWebGL) {
            this.qualityPresets = {
                low: { resolution: 256, numSteps: 200, stepSize: 0.01 },
                medium: { resolution: 512, numSteps: 400, stepSize: 0.005 },
                high: { resolution: 1024, numSteps: 800, stepSize: 0.0025 }
            };
        } else {
            this.qualityPresets = {
                low: { resolution: 64, numSteps: 64, stepSize: 2.0 },
                medium: { resolution: 128, numSteps: 128, stepSize: 1.0 },
                high: { resolution: 256, numSteps: 256, stepSize: 0.5 }
            };
        }

        this.currentQuality = 'medium';
        this.interactionQuality = 'low';

        // Render settings (for CPU renderer)
        this.settings = {
            stepSize: 1.0,
            threshold: 0
        };

        // Render state
        this.renderResolution = this.qualityPresets.medium.resolution;

        // Interaction state
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };

        // Progressive rendering
        this.refineTimer = null;
        this.isRendering = false;

        // Volume loaded flag
        this.volumeLoaded = false;

        this.setupEventListeners();
        this.drawPlaceholder();
    }

    /**
     * Initialize offscreen render buffers (CPU mode only)
     */
    initRenderBuffers() {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        this.imageData = null;
    }

    /**
     * Set up WebGL context lost/restored handlers
     */
    setupContextLostHandlers() {
        this.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('WebGL context lost');
            this.contextLost = true;
        });

        this.canvas.addEventListener('webglcontextrestored', () => {
            console.log('WebGL context restored');
            this.contextLost = false;
            // Reinitialize WebGL
            this.gl = WebGLUtils.createContext(this.canvas);
            if (this.gl) {
                this.webglRenderer = new WebGLMIPRenderer(this.canvas, this.gl);
                if (this.volumeData) {
                    this.webglRenderer.uploadVolume(this.volumeData);
                }
                this.render();
            }
        });
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
        this.volumeData = volumeData;

        if (this.useWebGL) {
            const success = this.webglRenderer.uploadVolume(volumeData);
            if (!success) {
                // Fall back to CPU if texture upload fails
                console.warn('WebGL texture upload failed, falling back to CPU');
                this.useWebGL = false;
                this.ctx = this.canvas.getContext('2d');
                this.raycaster = new MIPRaycaster();
                this.initRenderBuffers();
                this.raycaster.setVolume(volumeData);
                // Update quality presets to CPU values
                this.qualityPresets = {
                    low: { resolution: 64, numSteps: 64, stepSize: 2.0 },
                    medium: { resolution: 128, numSteps: 128, stepSize: 1.0 },
                    high: { resolution: 256, numSteps: 256, stepSize: 0.5 }
                };
            }
        } else {
            this.raycaster.setVolume(volumeData);
        }

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

        if (this.useWebGL) {
            const gl = this.gl;
            gl.viewport(0, 0, this.displaySize, this.displaySize);
            gl.clearColor(0.1, 0.1, 0.1, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        } else {
            this.ctx.fillStyle = '#1a1a1a';
            this.ctx.fillRect(0, 0, this.displaySize, this.displaySize);
        }

        // Draw text (need 2D context for text)
        const ctx2d = this.useWebGL ? null : this.ctx;
        if (ctx2d) {
            ctx2d.fillStyle = '#666';
            ctx2d.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx2d.textAlign = 'center';
            ctx2d.fillText('3D Rendering', this.displaySize / 2, this.displaySize / 2 - 10);

            ctx2d.fillStyle = '#555';
            ctx2d.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx2d.fillText('Load a volume to view', this.displaySize / 2, this.displaySize / 2 + 15);
        }
    }

    /**
     * Render at specified quality level
     */
    renderAtQuality(quality) {
        if (!this.volumeLoaded) return;

        const preset = this.qualityPresets[quality] || this.qualityPresets.medium;
        this.renderResolution = preset.resolution;

        if (this.useWebGL) {
            this.webglRenderer.setQuality(preset.numSteps, preset.stepSize);
        } else {
            this.settings.stepSize = preset.stepSize;
        }

        this.render();
    }

    /**
     * Main render function
     */
    render() {
        if (!this.volumeLoaded || this.isRendering) return;
        if (this.useWebGL && this.contextLost) return;

        this.isRendering = true;

        // Update canvas size based on container
        this.updateDisplaySize();

        if (this.useWebGL) {
            this.renderWebGL();
        } else {
            this.renderCPU();
        }

        this.isRendering = false;
    }

    /**
     * Render using WebGL
     */
    renderWebGL() {
        this.webglRenderer.render(this.camera);
        // Note: WebGL renders directly to canvas, no label overlay in WebGL mode
        // Could add a 2D overlay canvas for labels if needed
    }

    /**
     * Render using CPU raycaster
     */
    renderCPU() {
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
    }

    /**
     * Draw view label on canvas (CPU mode only)
     */
    drawLabel() {
        if (this.useWebGL) return;

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

        if (this.useWebGL) {
            this.webglRenderer.setQuality(preset.numSteps, preset.stepSize);
        } else {
            this.settings.stepSize = preset.stepSize;
        }
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
     * @param {number} min - Low value (in original data range)
     * @param {number} max - High value (in original data range)
     */
    setDisplayRange(min, max) {
        if (this.useWebGL && this.volumeData) {
            this.webglRenderer.setDisplayRange(min, max, this.volumeData.min, this.volumeData.max);
        } else if (this.raycaster) {
            this.raycaster.setDisplayRange(min, max);
        }
        this.renderAtQuality(this.currentQuality);
    }

    /**
     * Set gamma correction
     * @param {number} gamma - Gamma value (1.0 = no change, <1 = brighten, >1 = darken)
     */
    setGamma(gamma) {
        if (this.useWebGL) {
            this.webglRenderer.setGamma(gamma);
        } else if (this.raycaster) {
            this.raycaster.setGamma(gamma);
        }
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

    /**
     * Check if using WebGL rendering
     * @returns {boolean}
     */
    isUsingWebGL() {
        return this.useWebGL;
    }
}
