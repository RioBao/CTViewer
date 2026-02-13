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
            roll: 0,          // Rotation around world Z axis (degrees)
            distance: 1.0     // Zoom factor (1.0 = fit to viewport)
        };
        this.orientationQuat = { x: 0, y: 0, z: 0, w: 1 };
        this.syncQuatFromCamera();

        // Quality presets - WebGL can handle higher resolutions
        // Total ray length = numSteps * stepSize, needs to be >= 2.0 to traverse volume
        if (this.useWebGL) {
            this.qualityPresets = {
                low: { resolution: 256, numSteps: 200, stepSize: 0.01 },
                medium: { resolution: 1024, numSteps: 800, stepSize: 0.0025 },
                high: { resolution: 2048, numSteps: 3200, stepSize: 0.000625 }
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
        this.isTracking = false;       // Left button = track (rotate in 3D)
        this.isPanning = false;        // Both buttons = pan (translate/reposition)
        this.lastMouse = { x: 0, y: 0 };
        this.lastTrackballVec = null;
        this.buttonsDown = { left: false, right: false };

        // Pan offset (screen-space translation)
        this.pan = { x: 0, y: 0 };

        // Progressive rendering
        this.refineTimer = null;
        this.isRendering = false;

        // Volume loaded flag
        this.volumeLoaded = false;

        // Legacy volume resolution overlay (replaced by in-viewport UI controls)
        this.volumeInfoOverlay = null;
        this.createVolumeInfoOverlay();

        this.setupEventListeners();
        this.drawPlaceholder();
    }

    /**
     * Create a DOM overlay for showing volume resolution info
     */
    createVolumeInfoOverlay() {
        // Disabled: status is now rendered by the viewport control chip in script.js.
        this.volumeInfoOverlay = null;
    }

    /**
     * Show or hide the volume resolution overlay
     */
    updateVolumeInfoOverlay() {
        // No-op: kept for compatibility with existing loadVolume flow.
    }

    /**
     * Initialize offscreen render buffers (CPU mode only)
     */
    initRenderBuffers() {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        this.imageData = null;
        // Track offscreen canvas size to avoid unnecessary resizes
        this.offscreenWidth = 0;
        this.offscreenHeight = 0;
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
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Prevent right-click menu

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
        let newSize = this.displaySize;

        if (container) {
            const rect = container.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            // Use the smaller dimension to maintain square aspect for 3D view
            const size = Math.min(rect.width, rect.height);
            newSize = Math.min(Math.floor(size * dpr), maxSize);
        }

        // Only update if size actually changed - avoids GPU texture reallocation
        if (newSize !== this.displaySize) {
            this.displaySize = newSize;
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
            // Check GPU memory before attempting upload
            const memCheck = WebGLUtils.checkGPUMemory(
                this.gl,
                volumeData.dimensions,
                volumeData.dataType
            );

            if (memCheck.recommendation) {
                console.warn('GPU Memory:', memCheck.recommendation);
                // Dispatch event for UI to show warning
                document.dispatchEvent(new CustomEvent('gpumemorywarning', {
                    detail: {
                        message: memCheck.recommendation,
                        memoryInfo: memCheck.memoryInfo,
                        severity: memCheck.memoryInfo.warning || 'info'
                    }
                }));
            }

            let success = false;
            try {
                success = this.webglRenderer.uploadVolume(volumeData);
            } catch (e) {
                console.error('WebGL texture upload threw exception:', e);
                success = false;
            }

            if (!success) {
                // Fall back to CPU if texture upload fails
                console.warn('%c3D Renderer: Falling back to CPU%c (WebGL texture upload failed)', 'color: #FF9800; font-weight: bold', 'color: inherit');
                this.fallbackToCPU(volumeData);
            }
        } else {
            this.raycaster.setVolume(volumeData);
        }

        this.volumeLoaded = true;

        // Update resolution overlay
        this.updateVolumeInfoOverlay();

        // Log renderer info
        this.logRendererInfo();

        // Reset camera to default view
        this.camera.azimuth = 30;
        this.camera.elevation = 20;
        this.camera.roll = 0;
        this.camera.distance = 1.0;
        this.syncQuatFromCamera();

        // Initial render at medium quality
        this.renderAtQuality('medium');
    }

    /**
     * Fall back to CPU rendering
     */
    fallbackToCPU(volumeData) {
        this.useWebGL = false;
        this.ctx = this.canvas.getContext('2d');
        this.raycaster = new MIPRaycaster();
        this.initRenderBuffers();
        if (volumeData) {
            this.raycaster.setVolume(volumeData);
        }
        // Update quality presets to CPU values
        this.qualityPresets = {
            low: { resolution: 64, numSteps: 64, stepSize: 2.0 },
            medium: { resolution: 128, numSteps: 128, stepSize: 1.0 },
            high: { resolution: 256, numSteps: 256, stepSize: 0.5 }
        };

        // Dispatch event for UI
        document.dispatchEvent(new CustomEvent('rendererfallback', {
            detail: { reason: 'WebGL failed, using CPU rendering' }
        }));
    }

    /**
     * Draw placeholder when no volume is loaded
     */
    drawPlaceholder() {
        this.updateDisplaySize();

        if (this.useWebGL) {
            const gl = this.gl;
            gl.viewport(0, 0, this.displaySize, this.displaySize);
            gl.clearColor(10 / 255, 13 / 255, 19 / 255, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        } else {
            this.ctx.fillStyle = '#0A0D13';
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
        try {
            this.webglRenderer.render(this.camera, this.pan);
            // Note: WebGL renders directly to canvas, no label overlay in WebGL mode
            // Could add a 2D overlay canvas for labels if needed
        } catch (e) {
            console.error('WebGL render error:', e);
            // Fall back to CPU rendering
            if (!this.contextLost) {
                console.warn('WebGL render failed, attempting CPU fallback');
                this.fallbackToCPU(this.volumeData);
                this.renderCPU();
            }
        }
    }

    /**
     * Render using CPU raycaster
     */
    renderCPU() {
        try {
            // Only resize offscreen canvas when resolution changes
            if (this.offscreenWidth !== this.renderResolution ||
                this.offscreenHeight !== this.renderResolution) {
                this.offscreenCanvas.width = this.renderResolution;
                this.offscreenCanvas.height = this.renderResolution;
                this.offscreenWidth = this.renderResolution;
                this.offscreenHeight = this.renderResolution;
                // Force new ImageData after resize
                this.imageData = null;
            }

            // Reuse ImageData when possible
            if (!this.imageData ||
                this.imageData.width !== this.renderResolution ||
                this.imageData.height !== this.renderResolution) {
                this.imageData = this.offscreenCtx.createImageData(
                    this.renderResolution,
                    this.renderResolution
                );
            }

            // Perform raycasting
            this.raycaster.render(this.imageData, this.camera, this.settings);

            // Put rendered image to offscreen canvas
            this.offscreenCtx.putImageData(this.imageData, 0, 0);

            // Scale up to display canvas with smoothing disabled for crisp pixels
            this.ctx.imageSmoothingEnabled = false;
            this.ctx.fillStyle = '#0A0D13';
            this.ctx.fillRect(0, 0, this.displaySize, this.displaySize);
            // Apply pan offset when drawing
            this.ctx.drawImage(
                this.offscreenCanvas,
                0, 0, this.renderResolution, this.renderResolution,
                this.pan.x, this.pan.y, this.displaySize, this.displaySize
            );

            // Draw label
            this.drawLabel();
        } catch (e) {
            console.error('CPU render error (possible GPU issue with canvas):', e);
            // Try to show error message
            try {
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(0, 0, this.displaySize, this.displaySize);
                this.ctx.fillStyle = '#f00';
                this.ctx.font = '14px sans-serif';
                this.ctx.fillText('Render error', 10, 30);
            } catch (e2) { /* ignore */ }
        }
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

        // Record which button was pressed
        if (e.button === 0) this.buttonsDown.left = true;
        if (e.button === 2) this.buttonsDown.right = true;

        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.lastTrackballVec = this.getTrackballVector(e.clientX, e.clientY);
        this.updateInteractionState();
    }

    handleMouseMove(e) {
        // Check actual button state from event (more reliable)
        const leftDown = (e.buttons & 1) !== 0;
        const rightDown = (e.buttons & 2) !== 0;
        const bothDown = leftDown && rightDown;

        if (!leftDown && !rightDown) return;

        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;

        if (bothDown) {
            // Both buttons: pan (translate/reposition volume)
            this.pan.x += dx;
            this.pan.y += dy;
            this.lastTrackballVec = this.getTrackballVector(e.clientX, e.clientY);
            this.canvas.style.cursor = 'move';
        } else if (leftDown) {
            // Left button: position-aware arcball rotation.
            const prevVec = this.lastTrackballVec || this.getTrackballVector(this.lastMouse.x, this.lastMouse.y);
            const currVec = this.getTrackballVector(e.clientX, e.clientY);
            this.applyTrackballDelta(prevVec, currVec);
            this.lastTrackballVec = currVec;
            this.canvas.style.cursor = 'grabbing';
        }

        this.lastMouse = { x: e.clientX, y: e.clientY };

        // Render at interaction quality
        this.render();
    }

    handleMouseUp(e) {
        // Record which button was released
        if (e.button === 0) this.buttonsDown.left = false;
        if (e.button === 2) this.buttonsDown.right = false;
        if (!this.buttonsDown.left) this.lastTrackballVec = null;

        this.updateInteractionState();
    }

    handleMouseLeave(e) {
        // Reset all button states when mouse leaves canvas
        this.buttonsDown.left = false;
        this.buttonsDown.right = false;
        this.isTracking = false;
        this.isPanning = false;
        this.lastTrackballVec = null;
        this.canvas.style.cursor = 'grab';
        this.endInteraction();
    }

    /**
     * Update interaction state based on current button states
     */
    updateInteractionState() {
        const wasInteracting = this.isTracking || this.isPanning;

        if (this.buttonsDown.left && this.buttonsDown.right) {
            // Both buttons: pan
            this.isPanning = true;
            this.isTracking = false;
            this.canvas.style.cursor = 'move';
        } else if (this.buttonsDown.left) {
            // Left button: track
            this.isTracking = true;
            this.isPanning = false;
            this.canvas.style.cursor = 'grabbing';
        } else {
            this.isTracking = false;
            this.isPanning = false;
            this.canvas.style.cursor = 'grab';
        }

        const isInteracting = this.isTracking || this.isPanning;

        // Start/end interaction for quality switching
        if (isInteracting && !wasInteracting) {
            this.startInteraction();
        } else if (!isInteracting && wasInteracting) {
            this.endInteraction();
        }
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
        this.isTracking = true;  // Single touch = track (rotate)
        this.lastMouse = { x: touch.clientX, y: touch.clientY };
        this.lastTrackballVec = this.getTrackballVector(touch.clientX, touch.clientY);
        this.startInteraction();
    }

    handleTouchMove(e) {
        if (!this.isTracking || e.touches.length !== 1) return;

        e.preventDefault();
        const touch = e.touches[0];
        const prevVec = this.lastTrackballVec || this.getTrackballVector(this.lastMouse.x, this.lastMouse.y);
        const currVec = this.getTrackballVector(touch.clientX, touch.clientY);
        this.applyTrackballDelta(prevVec, currVec);
        this.lastTrackballVec = currVec;

        this.lastMouse = { x: touch.clientX, y: touch.clientY };
        this.render();
    }

    handleTouchEnd(e) {
        if (!this.isTracking) return;

        this.isTracking = false;
        this.lastTrackballVec = null;
        this.endInteraction();
    }

    getTrackballVector(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(rect.width, 1);
        const height = Math.max(rect.height, 1);

        // Map to [-1, 1], with +Y up for right-handed math.
        const x = ((clientX - rect.left) / width) * 2 - 1;
        const y = 1 - ((clientY - rect.top) / height) * 2;

        const r2 = x * x + y * y;
        const z = r2 <= 1 ? Math.sqrt(1 - r2) : 0;

        if (r2 > 1) {
            const invLen = 1 / Math.sqrt(r2);
            return { x: x * invLen, y: y * invLen, z };
        }

        return { x, y, z };
    }

    applyTrackballDelta(prev, curr) {
        // Reverse mapping so drag direction feels non-inverted.
        const deltaQuat = this.quatFromUnitVectors(curr, prev);
        this.orientationQuat = this.quatNormalize(this.quatMultiply(deltaQuat, this.orientationQuat));
        this.syncCameraFromQuat();
    }

    applyTurntableDelta(prevClientX, prevClientY, currClientX, currClientY) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;

        const dx = currClientX - prevClientX;
        const dy = currClientY - prevClientY;

        // Spin around world Z based on angular motion around viewport center.
        const prevVX = prevClientX - cx;
        const prevVY = prevClientY - cy;
        const currVX = currClientX - cx;
        const currVY = currClientY - cy;
        let deltaAngle = Math.atan2(currVY, currVX) - Math.atan2(prevVY, prevVX);
        if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
        if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

        // Reduce spin sensitivity near center where angular signal is noisy.
        const radiusPrev = Math.hypot(prevVX, prevVY);
        const radiusCurr = Math.hypot(currVX, currVY);
        const minHalf = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
        const radiusNorm = ((radiusPrev + radiusCurr) * 0.5) / minHalf;
        const leverage = Math.max(0, Math.min(1, (radiusNorm - 0.12) / 0.88));
        const spinDeltaDeg = (deltaAngle * 180 / Math.PI) * leverage;

        const tiltSensitivity = 0.12;
        const maxTilt = 75;
        this.camera.roll += spinDeltaDeg;
        const nextTilt = this.camera.elevation - dy * tiltSensitivity;
        this.camera.elevation = Math.max(-maxTilt, Math.min(maxTilt, nextTilt));
        this.syncQuatFromCamera();
    }

    syncQuatFromCamera() {
        const az = this.camera.azimuth * Math.PI / 180;
        const el = this.camera.elevation * Math.PI / 180;
        const roll = (this.camera.roll || 0) * Math.PI / 180;

        const qx = { x: Math.sin(el * 0.5), y: 0, z: 0, w: Math.cos(el * 0.5) };
        const qy = { x: 0, y: Math.sin(az * 0.5), z: 0, w: Math.cos(az * 0.5) };
        const qz = { x: 0, y: 0, z: Math.sin(roll * 0.5), w: Math.cos(roll * 0.5) };

        // Match renderer convention: R = Rz(roll) * Ry(azimuth) * Rx(elevation)
        this.orientationQuat = this.quatNormalize(this.quatMultiply(this.quatMultiply(qz, qy), qx));
    }

    syncCameraFromQuat() {
        const q = this.quatNormalize(this.orientationQuat);
        this.orientationQuat = q;

        const x = q.x, y = q.y, z = q.z, w = q.w;
        const xx = x * x, yy = y * y, zz = z * z;
        const xy = x * y, xz = x * z, yz = y * z;
        const wx = w * x, wy = w * y, wz = w * z;

        // 3x3 rotation matrix from quaternion.
        const m00 = 1 - 2 * (yy + zz);
        const m01 = 2 * (xy - wz);
        const m10 = 2 * (xy + wz);
        const m11 = 1 - 2 * (xx + zz);
        const m20 = 2 * (xz - wy);
        const m21 = 2 * (yz + wx);
        const m22 = 1 - 2 * (xx + yy);

        // Decompose R = Rz * Ry * Rx (same order used in shaders/CPU renderer).
        const az = Math.asin(Math.max(-1, Math.min(1, -m20)));
        let el;
        let roll;
        if (Math.abs(m20) < 0.9999999) {
            el = Math.atan2(m21, m22);
            roll = Math.atan2(m10, m00);
        } else {
            // Gimbal lock fallback.
            el = 0;
            roll = Math.atan2(-m01, m11);
        }

        this.camera.azimuth = az * 180 / Math.PI;
        this.camera.elevation = el * 180 / Math.PI;
        this.camera.roll = roll * 180 / Math.PI;
    }

    quatMultiply(a, b) {
        return {
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
        };
    }

    quatNormalize(q) {
        const len = Math.hypot(q.x, q.y, q.z, q.w);
        if (len < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
        const inv = 1 / len;
        return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
    }

    quatFromUnitVectors(from, to) {
        const EPS = 1e-6;
        let r = from.x * to.x + from.y * to.y + from.z * to.z + 1;

        if (r < EPS) {
            // 180-degree turn: pick any orthogonal axis.
            if (Math.abs(from.x) > Math.abs(from.z)) {
                return this.quatNormalize({ x: -from.y, y: from.x, z: 0, w: 0 });
            }
            return this.quatNormalize({ x: 0, y: -from.z, z: from.y, w: 0 });
        }

        const crossX = from.y * to.z - from.z * to.y;
        const crossY = from.z * to.x - from.x * to.z;
        const crossZ = from.x * to.y - from.y * to.x;

        return this.quatNormalize({ x: crossX, y: crossY, z: crossZ, w: r });
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
        this.camera.roll = 0;
        this.camera.distance = 1.0;
        this.pan = { x: 0, y: 0 };
        this.syncQuatFromCamera();
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
        this.syncQuatFromCamera();
        this.renderAtQuality(this.currentQuality);
    }

    /**
     * Check if using WebGL rendering
     * @returns {boolean}
     */
    isUsingWebGL() {
        return this.useWebGL;
    }

    /**
     * Log renderer information to console
     */
    logRendererInfo() {
        const renderer = this.useWebGL ? 'WebGL' : 'CPU';
        const preset = this.qualityPresets[this.currentQuality];

        console.log(
            `%c3D Renderer: ${renderer}%c | Quality: ${this.currentQuality} | Resolution: ${preset.resolution}px | Steps: ${preset.numSteps}`,
            'color: #4CAF50; font-weight: bold',
            'color: inherit'
        );

        if (this.useWebGL && this.gl) {
            const maxTextureSize = this.gl.getParameter(this.gl.MAX_3D_TEXTURE_SIZE);
            console.log(`  GPU Max 3D Texture Size: ${maxTextureSize}`);
        }

        if (this.volumeData) {
            const dims = this.volumeData.dimensions;
            const memInfo = WebGLUtils.estimateGPUMemory(dims, this.volumeData.dataType);
            console.log(`  Volume: ${dims[0]}×${dims[1]}×${dims[2]} (${memInfo.gpuMegabytes}MB GPU memory)`);
        }
    }

    /**
     * Clean up GPU resources
     */
    dispose() {
        // Cancel any pending renders
        if (this.refineTimer) {
            clearTimeout(this.refineTimer);
            this.refineTimer = null;
        }

        // Clean up WebGL resources
        if (this.webglRenderer) {
            this.webglRenderer.dispose();
            this.webglRenderer = null;
        }

        // Clean up CPU rendering resources
        if (this.offscreenCanvas) {
            this.offscreenCanvas.width = 1;
            this.offscreenCanvas.height = 1;
            this.offscreenCanvas = null;
            this.offscreenCtx = null;
        }

        this.imageData = null;
        this.volumeData = null;
        this.volumeLoaded = false;

        // Hide resolution overlay
        if (this.volumeInfoOverlay) {
            this.volumeInfoOverlay.style.display = 'none';
        }

        // Clear the main canvas
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        } else if (this.gl) {
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        }
    }
}
