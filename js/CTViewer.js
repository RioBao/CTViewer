class CTViewer {
    constructor() {
        this.volumeData = null;
        this.imageProcessor = new ImageProcessor();

        // Slice renderers for three orthogonal views
        this.renderers = {
            xy: null,
            xz: null,
            yz: null
        };

        // Centralized state
        this.state = {
            zoom: 1.0,
            pan: { x: 0, y: 0 },
            contrast: 1.0,
            brightness: 0,
            slices: { xy: 0, xz: 0, yz: 0 },
            activeView: null
        };

        // Mouse interaction state
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.panStart = { x: 0, y: 0 };

        // ROI selection state
        this.roiMode = false;
        this.roiSelecting = false;
        this.roiStart = { x: 0, y: 0 };
        this.roiEnd = { x: 0, y: 0 };
        this.roiCanvas = null; // Overlay canvas for drawing ROI

        // Crosshair state - current 3D position
        this.crosshairPosition = { x: 0, y: 0, z: 0 };
        this.crosshairEnabled = true;
        this.crosshairDragging = false;
        this.crosshairDragAxis = null; // Which view is being dragged

        // Debounce timer for rendering
        this.renderTimer = null;

        // 3D volume renderer
        this.renderer3D = null;

        // Maximized view state (null = grid view, 'xy'|'xz'|'yz'|'3d' = maximized)
        this.maximizedView = null;

        // Single-view mode (for depth-1 volumes / 2D images)
        this.singleViewMode = false;

        // Progressive loading state
        this.progressiveVolume = null;
        this.lowResVolume = null;
    }

    /**
     * Initialize the medical viewer with canvas elements
     */
    initialize(canvasXY, canvasXZ, canvasYZ, canvas3D) {
        // Create slice renderers
        this.renderers.xy = new SliceRenderer(canvasXY, 'Axial (XY)');
        this.renderers.xz = new SliceRenderer(canvasXZ, 'Coronal (XZ)');
        this.renderers.yz = new SliceRenderer(canvasYZ, 'Sagittal (YZ)');

        // Create 3D renderer if canvas provided
        if (canvas3D) {
            this.renderer3D = new VolumeRenderer3D(canvas3D);
        }

        // Store canvas references for maximize functionality
        this.canvases = {
            xy: canvasXY,
            xz: canvasXZ,
            yz: canvasYZ,
            '3d': canvas3D
        };

        // Set up event listeners for each canvas
        this.setupEventListeners(canvasXY, 'xy');
        this.setupEventListeners(canvasXZ, 'xz');
        this.setupEventListeners(canvasYZ, 'yz');
        this.setupEventListeners(canvas3D, '3d');
    }

    /**
     * Load volume data
     */
    loadVolume(volumeData) {
        this.volumeData = volumeData;

        // Initialize slice indices to middle of volume
        const [nx, ny, nz] = volumeData.dimensions;
        this.state.slices.xy = Math.floor(nz / 2);
        this.state.slices.xz = Math.floor(ny / 2);
        this.state.slices.yz = Math.floor(nx / 2);

        // Detect single-view mode (depth-1 volumes / 2D images)
        this.singleViewMode = (nz === 1);

        // Initialize crosshair position to center
        this.crosshairPosition = {
            x: Math.floor(nx / 2),
            y: Math.floor(ny / 2),
            z: Math.floor(nz / 2)
        };

        // Set data range for all renderers
        Object.values(this.renderers).forEach(renderer => {
            renderer.setDataRange(volumeData.min, volumeData.max);
        });

        // Load into 3D renderer (skip for single-slice volumes)
        if (this.renderer3D && !this.singleViewMode) {
            this.renderer3D.loadVolume(volumeData);
        }

        // Auto-maximize XY view for single-slice volumes
        if (this.singleViewMode) {
            this.maximizeView('xy');
        } else if (this.maximizedView) {
            // Restore grid view when loading a 3D volume
            this.restoreGridView();
        }

        // Initial render
        this.renderAllViews();

        // Notify initial crosshair position
        this.notifyCrosshairChange();

        // Notify initial slice positions
        this.notifySliceChange('xy', this.state.slices.xy, nz);
        this.notifySliceChange('xz', this.state.slices.xz, ny);
        this.notifySliceChange('yz', this.state.slices.yz, nx);

        return {
            dimensions: volumeData.dimensions,
            dataType: volumeData.dataType,
            range: [volumeData.min, volumeData.max]
        };
    }

    /**
     * Load volume data progressively with Z-axis tiling
     * @param {ProgressiveVolumeData} progressiveVolumeData
     * @returns {Object} Callbacks for progressive loading phases
     */
    loadVolumeProgressive(progressiveVolumeData) {
        this.progressiveVolume = progressiveVolumeData;

        // Return callbacks for the loader to call
        return {
            onLowResReady: (lowResVolume) => this.handleLowResReady(lowResVolume),
            onBlockReady: (blockIndex, zStart, zEnd) => this.handleBlockReady(blockIndex, zStart, zEnd),
            onAllBlocksReady: () => this.handleAllBlocksReady()
        };
    }

    /**
     * Handle low-res volume ready - initialize all views with preview
     */
    handleLowResReady(lowResVolume) {
        this.lowResVolume = lowResVolume;

        // progressiveVolume and volumeData should already be set by caller
        if (!this.progressiveVolume) {
            console.error('handleLowResReady called but progressiveVolume is not set');
            return;
        }

        // Initialize slice indices to middle of FULL resolution volume
        const [nx, ny, nz] = this.progressiveVolume.dimensions;
        this.state.slices.xy = Math.floor(nz / 2);
        this.state.slices.xz = Math.floor(ny / 2);
        this.state.slices.yz = Math.floor(nx / 2);

        // Detect single-view mode
        this.singleViewMode = (nz === 1);

        // Initialize crosshair position to center
        this.crosshairPosition = {
            x: Math.floor(nx / 2),
            y: Math.floor(ny / 2),
            z: Math.floor(nz / 2)
        };

        // Set data range for all renderers using min/max from full-res scan
        Object.values(this.renderers).forEach(renderer => {
            renderer.setDataRange(this.progressiveVolume.min, this.progressiveVolume.max);
        });

        // Load LOW-RES into 3D renderer for immediate preview
        if (this.renderer3D && !this.singleViewMode) {
            this.renderer3D.loadVolume(lowResVolume);
        }

        // Auto-maximize XY view for single-slice volumes
        if (this.singleViewMode) {
            this.maximizeView('xy');
        } else if (this.maximizedView) {
            this.restoreGridView();
        }

        // Initial render with low-res/mixed data
        this.renderAllViews();

        // Notify UI
        this.notifyCrosshairChange();
        this.notifySliceChange('xy', this.state.slices.xy, nz);
        this.notifySliceChange('xz', this.state.slices.xz, ny);
        this.notifySliceChange('yz', this.state.slices.yz, nx);

        // Dispatch event for UI (e.g., loading progress)
        document.dispatchEvent(new CustomEvent('volumelowresready', {
            detail: {
                dimensions: this.progressiveVolume.dimensions,
                dataRange: [this.progressiveVolume.min, this.progressiveVolume.max]
            }
        }));

        console.log('CTViewer: Low-res ready, showing preview');
    }

    /**
     * Handle block ready - update affected views
     */
    handleBlockReady(blockIndex, zStart, zEnd) {
        if (!this.progressiveVolume) return;

        const [nx, ny, nz] = this.progressiveVolume.dimensions;

        // XY view: only re-render if current slice is in this block's Z range
        if (this.state.slices.xy >= zStart && this.state.slices.xy < zEnd) {
            this.renderView('xy');
        }

        // XZ and YZ views span all Z, so they always need updating
        this.renderView('xz');
        this.renderView('yz');

        // Draw crosshairs
        if (this.crosshairEnabled) {
            this.drawCrosshairs();
        }

        // Dispatch event for UI (loading progress)
        const progress = this.progressiveVolume.getLoadProgress();
        document.dispatchEvent(new CustomEvent('blockloaded', {
            detail: {
                blockIndex,
                zStart,
                zEnd,
                blocksLoaded: progress.blocksLoaded,
                totalBlocks: progress.totalBlocks,
                percent: progress.percent
            }
        }));

        console.log(`CTViewer: Block ${blockIndex} ready (z=${zStart}-${zEnd}), ${progress.percent}% complete`);
    }

    /**
     * Handle all blocks ready - upload full-res to 3D renderer
     */
    handleAllBlocksReady() {
        if (!this.progressiveVolume) return;

        console.log('CTViewer: All blocks loaded, updating 3D renderer');

        // Upload full-resolution volume to 3D renderer if it fits in GPU memory.
        // For large volumes, keep the low-res 3D (already loaded from handleLowResReady).
        if (this.renderer3D && !this.singleViewMode) {
            const fullResVolume = this.progressiveVolume.getFullVolumeData();
            const [nx, ny, nz] = fullResVolume.dimensions;
            const memMB = nx * ny * nz / (1024 * 1024); // R8 = 1 byte/voxel
            if (memMB <= 1536) {
                this.renderer3D.loadVolume(fullResVolume);
            } else {
                console.log(`CTViewer: Skipping 3D upload (${memMB.toFixed(0)}MB > 1536MB limit), keeping low-res 3D`);
            }
        }

        // Dispatch completion event
        document.dispatchEvent(new CustomEvent('volumeloadcomplete', {
            detail: {
                dimensions: this.progressiveVolume.dimensions,
                dataRange: [this.progressiveVolume.min, this.progressiveVolume.max]
            }
        }));
    }

    /**
     * Check if 3D enhancement is available
     */
    canEnhance3D() {
        return this.progressiveVolume &&
               typeof this.progressiveVolume.canEnhance3D === 'function' &&
               this.progressiveVolume.canEnhance3D();
    }

    /**
     * Enhance 3D volume resolution (loads higher-res version)
     * @param {function} onProgress - Progress callback (0-100)
     * @returns {Promise<boolean>} Success
     */
    async enhance3D(onProgress) {
        if (!this.canEnhance3D()) {
            console.warn('3D enhancement not available for this volume');
            return false;
        }

        if (!this.renderer3D) {
            console.warn('No 3D renderer available');
            return false;
        }

        console.log('CTViewer: Starting 3D enhancement...');

        try {
            const enhancedVolume = await this.progressiveVolume.createEnhanced3DVolume(onProgress);

            if (enhancedVolume) {
                this.renderer3D.loadVolume(enhancedVolume);
                console.log('CTViewer: 3D enhancement complete');
                return true;
            }
        } catch (e) {
            console.error('3D enhancement failed:', e);
        }

        return false;
    }

    /**
     * Render all three orthogonal views
     */
    renderAllViews() {
        if (!this.volumeData) return;

        // Update rendering parameters for all views
        const params = {
            zoom: this.state.zoom,
            pan: this.state.pan,
            contrast: this.state.contrast,
            brightness: this.state.brightness
        };

        Object.values(this.renderers).forEach(renderer => {
            renderer.updateParameters(params);
        });

        // Render each view with its current slice
        try {
            const xySlice = this.volumeData.getSlice('xy', this.state.slices.xy);
            this.renderers.xy.render(xySlice, this.imageProcessor);

            const xzSlice = this.volumeData.getSlice('xz', this.state.slices.xz);
            this.renderers.xz.render(xzSlice, this.imageProcessor);

            const yzSlice = this.volumeData.getSlice('yz', this.state.slices.yz);
            this.renderers.yz.render(yzSlice, this.imageProcessor);

            // Draw crosshairs on all views
            if (this.crosshairEnabled) {
                this.drawCrosshairs();
            }
        } catch (error) {
            console.error('Rendering error:', error);
        }
    }

    /**
     * Render a specific view
     * @param {string} axis - The axis to render ('xy', 'xz', 'yz')
     * @param {number} [sliceIndex] - Optional slice index to render; if not provided, uses current state
     */
    renderView(axis, sliceIndex) {
        if (!this.volumeData || !this.renderers[axis]) return;

        try {
            const index = sliceIndex !== undefined ? sliceIndex : this.state.slices[axis];
            const slice = this.volumeData.getSlice(axis, index);
            const params = {
                zoom: this.state.zoom,
                pan: this.state.pan,
                contrast: this.state.contrast,
                brightness: this.state.brightness
            };
            this.renderers[axis].updateParameters(params);
            this.renderers[axis].render(slice, this.imageProcessor);
        } catch (error) {
            console.error(`Rendering error for ${axis}:`, error);
        }
    }

    /**
     * Set up event listeners for a canvas
     */
    setupEventListeners(canvas, axis) {
        if (!canvas) return;

        // Double-click to toggle maximize/restore view
        canvas.addEventListener('dblclick', (e) => this.toggleMaximizeView(axis));

        // Skip other events for 3D canvas (handled by VolumeRenderer3D)
        if (axis === '3d') return;

        // Mouse wheel for slice navigation and zoom
        canvas.addEventListener('wheel', (e) => this.handleWheel(e, axis), { passive: false });

        // Mouse events for panning
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e, axis));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e, axis));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e, axis));
        canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e, axis));

        // Touch events (for mobile support)
        canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e, axis), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e, axis), { passive: false });
        canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e, axis));

        // Track active view on mouse enter
        canvas.addEventListener('mouseenter', () => {
            this.state.activeView = axis;
        });
    }

    /**
     * Handle mouse wheel event
     */
    handleWheel(e, axis) {
        e.preventDefault();

        if (e.ctrlKey) {
            // Zoom (synchronized across all views)
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.updateZoom(this.state.zoom + delta);
        } else {
            // In single-view mode, only allow slice navigation if there are multiple slices
            // (e.g., RGB volumes with 3 channels)
            if (this.singleViewMode && axis === 'xy' && this.volumeData.dimensions[2] <= 1) {
                // Single slice - treat wheel as zoom instead
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                this.updateZoom(this.state.zoom + delta);
            } else {
                // Slice navigation (only active view)
                const delta = e.deltaY > 0 ? 1 : -1;
                this.navigateSlice(axis, delta);
            }
        }
    }

    /**
     * Handle mouse down
     */
    handleMouseDown(e, axis) {
        if (this.roiMode) {
            this.roiSelecting = true;
            this.roiStart = { x: e.clientX, y: e.clientY };
            this.roiEnd = { x: e.clientX, y: e.clientY };
            this.state.activeView = axis;
            this.createRoiOverlay(e.target);
            e.target.style.cursor = 'crosshair';
            return;
        }

        // Check if clicking near crosshair
        if (this.crosshairEnabled && this.isNearCrosshair(e, axis)) {
            this.crosshairDragging = true;
            this.crosshairDragAxis = axis;
            this.state.activeView = axis;
            e.target.style.cursor = 'move';
            // Update crosshair position immediately
            this.updateCrosshairFromMouse(e, axis);
            return;
        }

        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.panStart = { x: this.state.pan.x, y: this.state.pan.y };
        this.state.activeView = axis;
        e.target.style.cursor = 'grabbing';
    }

    /**
     * Handle mouse move
     */
    handleMouseMove(e, axis) {
        if (this.roiSelecting) {
            this.roiEnd = { x: e.clientX, y: e.clientY };
            this.drawRoiRectangle(e.target);
            return;
        }

        if (this.crosshairDragging) {
            this.updateCrosshairFromMouse(e, this.crosshairDragAxis);
            return;
        }

        // Update cursor based on proximity to crosshair
        if (!this.isDragging && this.crosshairEnabled && !this.roiMode) {
            if (this.isNearCrosshair(e, axis)) {
                e.target.style.cursor = 'move';
            } else {
                e.target.style.cursor = 'grab';
            }
        }

        if (!this.isDragging) return;

        // Scale mouse delta to canvas coordinates
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const dx = (e.clientX - this.dragStart.x) * scaleX;
        const dy = (e.clientY - this.dragStart.y) * scaleY;

        this.updatePan(
            this.panStart.x + dx,
            this.panStart.y + dy
        );
    }

    /**
     * Handle mouse up
     */
    handleMouseUp(e, axis) {
        if (this.roiSelecting) {
            this.roiSelecting = false;
            this.roiEnd = { x: e.clientX, y: e.clientY };
            this.applyRoiSelection(e.target, axis);
            this.removeRoiOverlay();
            e.target.style.cursor = this.roiMode ? 'crosshair' : 'grab';
            return;
        }

        if (this.crosshairDragging) {
            this.crosshairDragging = false;
            this.crosshairDragAxis = null;
            e.target.style.cursor = 'grab';
            return;
        }

        if (this.isDragging) {
            this.isDragging = false;
            e.target.style.cursor = 'grab';
        }
    }

    /**
     * Handle touch start
     */
    handleTouchStart(e, axis) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY, target: e.target }, axis);
        }
    }

    /**
     * Handle touch move
     */
    handleTouchMove(e, axis) {
        if (e.touches.length === 1) {
            e.preventDefault();
            const touch = e.touches[0];
            this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: e.target }, axis);
        }
    }

    /**
     * Handle touch end
     */
    handleTouchEnd(e, axis) {
        this.handleMouseUp({ target: e.target }, axis);
    }

    /**
     * Navigate to a different slice
     */
    navigateSlice(axis, delta) {
        if (!this.volumeData) return;

        const [nx, ny, nz] = this.volumeData.dimensions;
        const maxSlice = axis === 'xy' ? nz - 1 : axis === 'xz' ? ny - 1 : nx - 1;

        const newSlice = Math.max(0, Math.min(maxSlice, this.state.slices[axis] + delta));

        if (newSlice !== this.state.slices[axis]) {
            this.state.slices[axis] = newSlice;

            // Update crosshair position to match current slice
            if (axis === 'xy') {
                this.crosshairPosition.z = newSlice;
            } else if (axis === 'xz') {
                this.crosshairPosition.y = newSlice;
            } else if (axis === 'yz') {
                this.crosshairPosition.x = newSlice;
            }

            // Render all views since crosshair position affects all of them
            this.debouncedRenderAll();
            this.notifySliceChange(axis, newSlice, maxSlice + 1);
            this.notifyCrosshairChange();
        }
    }

    /**
     * Update zoom (synchronized)
     */
    updateZoom(newZoom) {
        this.state.zoom = Math.max(0.1, Math.min(5, newZoom));
        this.debouncedRenderAll();
        this.notifyZoomChange(this.state.zoom);
    }

    /**
     * Update pan (synchronized)
     */
    updatePan(x, y) {
        this.state.pan = { x, y };
        this.debouncedRenderAll();
    }

    /**
     * Update contrast
     */
    updateContrast(contrast) {
        this.state.contrast = Math.max(0.5, Math.min(2.0, contrast));
        this.debouncedRenderAll();
    }

    /**
     * Update brightness
     */
    updateBrightness(brightness) {
        this.state.brightness = Math.max(-100, Math.min(100, brightness));
        this.debouncedRenderAll();
    }

    /**
     * Reset view
     */
    resetView() {
        this.state.zoom = 1.0;
        this.state.pan = { x: 0, y: 0 };
        this.state.contrast = 1.0;
        this.state.brightness = 0;
        this.renderAllViews();
        this.notifyZoomChange(1.0);
    }

    /**
     * Debounced rendering for single view
     */
    debouncedRender(axis) {
        clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => {
            requestAnimationFrame(() => this.renderView(axis));
        }, 16); // ~60fps
    }

    /**
     * Debounced rendering for all views
     */
    debouncedRenderAll() {
        clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => {
            requestAnimationFrame(() => this.renderAllViews());
        }, 16); // ~60fps
    }

    /**
     * Notify observers of slice change (for UI updates)
     */
    notifySliceChange(axis, sliceIndex, totalSlices) {
        // Get channel label for RGB volumes (XY axis only)
        let channelLabel = null;
        if (axis === 'xy' && this.volumeData && this.volumeData.getChannelLabel) {
            channelLabel = this.volumeData.getChannelLabel(sliceIndex);
        }

        const event = new CustomEvent('slicechange', {
            detail: { axis, sliceIndex, totalSlices, channelLabel }
        });
        document.dispatchEvent(event);
    }

    /**
     * Notify observers of zoom change (for UI updates)
     */
    notifyZoomChange(zoom) {
        const event = new CustomEvent('zoomchange', {
            detail: { zoom }
        });
        document.dispatchEvent(event);
    }

    /**
     * Notify observers of crosshair position change (for pixel value display)
     */
    notifyCrosshairChange() {
        if (!this.crosshairEnabled || !this.volumeData) return;

        const { x, y, z } = this.crosshairPosition;
        const value = this.volumeData.getValue(
            Math.floor(x),
            Math.floor(y),
            Math.floor(z)
        );

        const event = new CustomEvent('crosshairchange', {
            detail: {
                x: Math.floor(x),
                y: Math.floor(y),
                z: Math.floor(z),
                value: value
            }
        });
        document.dispatchEvent(event);
    }

    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Get volume info
     */
    getVolumeInfo() {
        return this.volumeData ? this.volumeData.getInfo() : null;
    }

    // ===== Crosshair Methods =====

    /**
     * Check if mouse position is near the crosshair lines
     */
    isNearCrosshair(e, axis) {
        if (!this.volumeData) return false;

        const renderer = this.renderers[axis];
        if (!renderer || !renderer.canvas) return false;

        const canvas = renderer.canvas;
        const rect = canvas.getBoundingClientRect();

        // Scale mouse coordinates to canvas internal size (canvas may be scaled by CSS)
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        // Get crosshair position in canvas coordinates
        let imageX, imageY;
        switch (axis) {
            case 'xy':
                imageX = this.crosshairPosition.x;
                imageY = this.crosshairPosition.y;
                break;
            case 'xz':
                imageX = this.crosshairPosition.x;
                imageY = this.crosshairPosition.z;
                break;
            case 'yz':
                imageX = this.crosshairPosition.y;
                imageY = this.crosshairPosition.z;
                break;
        }

        const canvasCoords = this.imageToCanvasCoords(imageX, imageY, renderer);
        if (!canvasCoords) return false;

        const threshold = 10; // pixels
        const nearHorizontal = Math.abs(mouseY - canvasCoords.y) < threshold;
        const nearVertical = Math.abs(mouseX - canvasCoords.x) < threshold;

        return nearHorizontal || nearVertical;
    }

    /**
     * Update crosshair position from mouse event
     */
    updateCrosshairFromMouse(e, axis) {
        if (!this.volumeData) return;

        const renderer = this.renderers[axis];
        if (!renderer) return;

        const canvas = renderer.canvas;
        const rect = canvas.getBoundingClientRect();

        // Scale mouse coordinates to canvas internal size (canvas may be scaled by CSS)
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        // Convert canvas coordinates to image coordinates
        const imageCoords = this.canvasToImageCoords(canvasX, canvasY, renderer);
        if (!imageCoords) return;

        const [nx, ny, nz] = this.volumeData.dimensions;

        // Update crosshair position and slice indices based on which view is being dragged
        switch (axis) {
            case 'xy':
                this.crosshairPosition.x = Math.max(0, Math.min(nx - 1, imageCoords.x));
                this.crosshairPosition.y = Math.max(0, Math.min(ny - 1, imageCoords.y));
                this.state.slices.yz = this.crosshairPosition.x;
                this.state.slices.xz = this.crosshairPosition.y;
                break;
            case 'xz':
                this.crosshairPosition.x = Math.max(0, Math.min(nx - 1, imageCoords.x));
                this.crosshairPosition.z = Math.max(0, Math.min(nz - 1, imageCoords.y));
                this.state.slices.yz = this.crosshairPosition.x;
                this.state.slices.xy = this.crosshairPosition.z;
                break;
            case 'yz':
                this.crosshairPosition.y = Math.max(0, Math.min(ny - 1, imageCoords.x));
                this.crosshairPosition.z = Math.max(0, Math.min(nz - 1, imageCoords.y));
                this.state.slices.xz = this.crosshairPosition.y;
                this.state.slices.xy = this.crosshairPosition.z;
                break;
        }

        // Notify slice changes
        this.notifySliceChange('xy', this.state.slices.xy, nz);
        this.notifySliceChange('xz', this.state.slices.xz, ny);
        this.notifySliceChange('yz', this.state.slices.yz, nx);

        // Notify crosshair position change (for pixel value display)
        this.notifyCrosshairChange();

        // Re-render all views
        this.renderAllViews();
    }

    /**
     * Convert canvas coordinates to image coordinates
     */
    canvasToImageCoords(canvasX, canvasY, renderer) {
        const sliceWidth = renderer.currentWidth;
        const sliceHeight = renderer.currentHeight;
        if (!sliceWidth || !sliceHeight) return null;

        const canvasWidth = renderer.canvas.width;
        const canvasHeight = renderer.canvas.height;
        const scaleX = canvasWidth / sliceWidth;
        const scaleY = canvasHeight / sliceHeight;
        const baseScale = Math.min(scaleX, scaleY);

        const scaledWidth = sliceWidth * baseScale;
        const scaledHeight = sliceHeight * baseScale;
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;

        const zoom = this.state.zoom;
        const pan = this.state.pan;

        // Reverse transform
        let x = canvasX - (centerX + pan.x);
        let y = canvasY - (centerY + pan.y);
        x /= zoom;
        y /= zoom;
        x += scaledWidth / 2;
        y += scaledHeight / 2;
        x /= baseScale;
        y /= baseScale;

        return { x: Math.floor(x), y: Math.floor(y) };
    }

    /**
     * Convert image coordinates to canvas coordinates
     */
    imageToCanvasCoords(imageX, imageY, renderer) {
        const sliceWidth = renderer.currentWidth;
        const sliceHeight = renderer.currentHeight;
        if (!sliceWidth || !sliceHeight) return null;

        const canvasWidth = renderer.canvas.width;
        const canvasHeight = renderer.canvas.height;
        const scaleX = canvasWidth / sliceWidth;
        const scaleY = canvasHeight / sliceHeight;
        const baseScale = Math.min(scaleX, scaleY);

        const scaledWidth = sliceWidth * baseScale;
        const scaledHeight = sliceHeight * baseScale;
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;

        const zoom = this.state.zoom;
        const pan = this.state.pan;

        // Forward transform
        let x = imageX * baseScale;
        let y = imageY * baseScale;
        x -= scaledWidth / 2;
        y -= scaledHeight / 2;
        x *= zoom;
        y *= zoom;
        x += centerX + pan.x;
        y += centerY + pan.y;

        return { x, y };
    }

    /**
     * Draw crosshairs on all views
     */
    drawCrosshairs() {
        if (!this.volumeData) return;

        const [nx, ny, nz] = this.volumeData.dimensions;

        // XY view: crosshair at (x, y) position
        this.drawCrosshairOnView('xy', this.crosshairPosition.x, this.crosshairPosition.y);

        // XZ view: crosshair at (x, z) position
        this.drawCrosshairOnView('xz', this.crosshairPosition.x, this.crosshairPosition.z);

        // YZ view: crosshair at (y, z) position
        this.drawCrosshairOnView('yz', this.crosshairPosition.y, this.crosshairPosition.z);
    }

    /**
     * Draw crosshair on a specific view
     */
    drawCrosshairOnView(axis, imageX, imageY) {
        const renderer = this.renderers[axis];
        if (!renderer || !renderer.canvas) return;

        const canvas = renderer.canvas;
        const ctx = canvas.getContext('2d');

        // Convert image coords to canvas coords
        const canvasCoords = this.imageToCanvasCoords(imageX, imageY, renderer);
        if (!canvasCoords) return;

        const { x, y } = canvasCoords;

        try {
            ctx.save();
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 1;
            // Avoid setLineDash - known to cause GPU issues in Edge
            // ctx.setLineDash([]) is implicit when lineDash is not set

            // Draw all lines in a single path to reduce GPU state changes
            ctx.beginPath();
            // Horizontal line
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            // Vertical line
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();

            // Draw small circle at intersection (separate path for arc)
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.stroke();

            ctx.restore();
        } catch (e) {
            // GPU operation failed - silently ignore crosshair drawing
            try { ctx.restore(); } catch (e2) { /* ignore */ }
        }
    }

    /**
     * Toggle crosshair visibility
     */
    toggleCrosshairs() {
        this.crosshairEnabled = !this.crosshairEnabled;
        this.renderAllViews();
        return this.crosshairEnabled;
    }

    /**
     * Check if crosshairs are enabled
     */
    isCrosshairEnabled() {
        return this.crosshairEnabled;
    }

    // ===== ROI Selection Methods =====

    /**
     * Toggle ROI selection mode
     */
    toggleRoiMode() {
        this.roiMode = !this.roiMode;

        // Update cursor for all canvases
        Object.values(this.renderers).forEach(renderer => {
            if (renderer && renderer.canvas) {
                renderer.canvas.style.cursor = this.roiMode ? 'crosshair' : 'grab';
            }
        });

        return this.roiMode;
    }

    /**
     * Check if ROI mode is active
     */
    isRoiMode() {
        return this.roiMode;
    }

    /**
     * Create overlay canvas for drawing ROI rectangle
     */
    createRoiOverlay(targetCanvas) {
        if (this.roiCanvas) {
            this.removeRoiOverlay();
        }

        // Get the displayed size of the target canvas
        const rect = targetCanvas.getBoundingClientRect();

        this.roiCanvas = document.createElement('canvas');
        this.roiCanvas.width = rect.width;
        this.roiCanvas.height = rect.height;
        this.roiCanvas.style.position = 'absolute';
        this.roiCanvas.style.top = targetCanvas.offsetTop + 'px';
        this.roiCanvas.style.left = targetCanvas.offsetLeft + 'px';
        this.roiCanvas.style.pointerEvents = 'none';
        this.roiCanvas.style.zIndex = '10';

        targetCanvas.parentElement.appendChild(this.roiCanvas);
    }

    /**
     * Draw ROI selection rectangle
     */
    drawRoiRectangle(targetCanvas) {
        if (!this.roiCanvas) return;

        const ctx = this.roiCanvas.getContext('2d');

        try {
            ctx.clearRect(0, 0, this.roiCanvas.width, this.roiCanvas.height);

            // Convert client coordinates to overlay canvas coordinates
            // The overlay canvas matches the displayed size, not the internal canvas size
            const rect = targetCanvas.getBoundingClientRect();
            const x1 = this.roiStart.x - rect.left;
            const y1 = this.roiStart.y - rect.top;
            const x2 = this.roiEnd.x - rect.left;
            const y2 = this.roiEnd.y - rect.top;

            const x = Math.min(x1, x2);
            const y = Math.min(y1, y2);
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);

            // Draw semi-transparent fill first
            ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
            ctx.fillRect(x, y, width, height);

            // Draw rectangle border - avoid setLineDash for GPU compatibility
            // Use double-line technique instead of dashed line
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#00ff00';
            ctx.strokeRect(x, y, width, height);
        } catch (e) {
            // GPU operation failed - silently ignore
        }
    }

    /**
     * Remove ROI overlay canvas
     */
    removeRoiOverlay() {
        if (this.roiCanvas && this.roiCanvas.parentElement) {
            this.roiCanvas.parentElement.removeChild(this.roiCanvas);
        }
        this.roiCanvas = null;
    }

    /**
     * Apply ROI selection - calculate min/max from region and update display range
     */
    applyRoiSelection(targetCanvas, axis) {
        if (!this.volumeData) return;

        const renderer = this.renderers[axis];
        if (!renderer || !renderer.currentSliceData) return;

        // Convert client coordinates to canvas coordinates
        const rect = targetCanvas.getBoundingClientRect();
        const canvasX1 = this.roiStart.x - rect.left;
        const canvasY1 = this.roiStart.y - rect.top;
        const canvasX2 = this.roiEnd.x - rect.left;
        const canvasY2 = this.roiEnd.y - rect.top;

        // Get the slice data dimensions
        const sliceWidth = renderer.currentWidth;
        const sliceHeight = renderer.currentHeight;

        // Calculate the transform to convert canvas coords to image coords
        // This needs to account for zoom, pan, and fit-to-canvas scaling
        // Use the displayed size, not the internal canvas size
        const displayWidth = rect.width;
        const displayHeight = rect.height;
        const imgScaleX = displayWidth / sliceWidth;
        const imgScaleY = displayHeight / sliceHeight;
        const baseScale = Math.min(imgScaleX, imgScaleY);

        const scaledWidth = sliceWidth * baseScale;
        const scaledHeight = sliceHeight * baseScale;
        const centerX = displayWidth / 2;
        const centerY = displayHeight / 2;

        // Reverse the transform: canvas -> image coordinates
        const zoom = this.state.zoom;
        // Pan is stored in internal canvas coordinates, scale to displayed coordinates
        const panScaleX = displayWidth / targetCanvas.width;
        const panScaleY = displayHeight / targetCanvas.height;
        const panX = this.state.pan.x * panScaleX;
        const panY = this.state.pan.y * panScaleY;

        // Transform function
        const canvasToImage = (cx, cy) => {
            // Reverse: translate, scale, translate
            let x = cx - (centerX + panX);
            let y = cy - (centerY + panY);
            x /= zoom;
            y /= zoom;
            x += scaledWidth / 2;
            y += scaledHeight / 2;
            // Convert from scaled coords to image coords
            x /= baseScale;
            y /= baseScale;
            return { x: Math.floor(x), y: Math.floor(y) };
        };

        // Convert all four corners
        const img1 = canvasToImage(canvasX1, canvasY1);
        const img2 = canvasToImage(canvasX2, canvasY2);

        // Get bounding box in image coordinates
        const imgX1 = Math.max(0, Math.min(img1.x, img2.x));
        const imgY1 = Math.max(0, Math.min(img1.y, img2.y));
        const imgX2 = Math.min(sliceWidth - 1, Math.max(img1.x, img2.x));
        const imgY2 = Math.min(sliceHeight - 1, Math.max(img1.y, img2.y));

        // Check if selection is valid
        if (imgX2 <= imgX1 || imgY2 <= imgY1) {
            console.warn('ROI selection too small or outside image');
            return;
        }

        // Calculate min/max from the selected region
        const sliceData = renderer.currentSliceData.data;
        let min = Infinity;
        let max = -Infinity;

        for (let y = imgY1; y <= imgY2; y++) {
            for (let x = imgX1; x <= imgX2; x++) {
                const idx = y * sliceWidth + x;
                const value = sliceData[idx];
                if (value < min) min = value;
                if (value > max) max = value;
            }
        }

        if (min === Infinity || max === -Infinity || min === max) {
            console.warn('Could not calculate valid range from ROI');
            return;
        }

        // Update data range for all renderers
        Object.values(this.renderers).forEach(r => {
            r.setDataRange(min, max);
        });

        // Re-render all views
        this.renderAllViews();

        // Notify UI about the new range
        this.notifyRangeChange(min, max);

        console.log(`ROI range set: ${min} - ${max}`);
    }

    /**
     * Notify observers of range change (for UI updates)
     */
    notifyRangeChange(min, max) {
        const event = new CustomEvent('rangechange', {
            detail: { min, max }
        });
        document.dispatchEvent(event);
    }

    /**
     * Reset data range to full volume range
     */
    resetDataRange() {
        if (!this.volumeData) return;

        Object.values(this.renderers).forEach(renderer => {
            renderer.setDataRange(this.volumeData.min, this.volumeData.max);
        });

        this.renderAllViews();
        this.notifyRangeChange(this.volumeData.min, this.volumeData.max);
    }

    // ===== View Maximize Methods =====

    /**
     * Toggle between maximized single view and 2x2 grid view
     */
    toggleMaximizeView(axis) {
        const ct3DView = document.getElementById('ct3DView');
        if (!ct3DView) return;

        if (this.maximizedView === axis) {
            // Already maximized on this view - restore to grid
            this.restoreGridView();
        } else {
            // Maximize this view
            this.maximizeView(axis);
        }
    }

    /**
     * Maximize a single view to take up the full space
     */
    maximizeView(axis) {
        const ct3DView = document.getElementById('ct3DView');
        if (!ct3DView) return;

        this.maximizedView = axis;

        // Add maximized class to the container
        ct3DView.classList.add('maximized');

        // Hide all viewport containers except the one being maximized
        const viewportContainers = ct3DView.querySelectorAll('.viewport-container');
        viewportContainers.forEach(container => {
            const canvas = container.querySelector('canvas');
            if (canvas) {
                const canvasAxis = this.getAxisFromCanvas(canvas);
                if (canvasAxis === axis) {
                    container.classList.add('maximized-viewport');
                    container.classList.remove('hidden-viewport');
                } else {
                    container.classList.add('hidden-viewport');
                    container.classList.remove('maximized-viewport');
                }
            }
        });

        // Re-render to update canvas sizes
        this.debouncedRenderAll();

        // Dispatch event for UI updates
        document.dispatchEvent(new CustomEvent('viewmaximize', {
            detail: { axis, maximized: true }
        }));
    }

    /**
     * Restore the 2x2 grid view
     */
    restoreGridView() {
        const ct3DView = document.getElementById('ct3DView');
        if (!ct3DView) return;

        this.maximizedView = null;

        // Remove maximized class from the container
        ct3DView.classList.remove('maximized');

        // Show all viewport containers
        const viewportContainers = ct3DView.querySelectorAll('.viewport-container');
        viewportContainers.forEach(container => {
            container.classList.remove('maximized-viewport', 'hidden-viewport');
        });

        // Re-render to update canvas sizes
        this.debouncedRenderAll();

        // Dispatch event for UI updates
        document.dispatchEvent(new CustomEvent('viewmaximize', {
            detail: { axis: null, maximized: false }
        }));
    }

    /**
     * Get axis identifier from canvas element
     */
    getAxisFromCanvas(canvas) {
        if (canvas === this.canvases.xy) return 'xy';
        if (canvas === this.canvases.xz) return 'xz';
        if (canvas === this.canvases.yz) return 'yz';
        if (canvas === this.canvases['3d']) return '3d';
        return null;
    }

    /**
     * Check if a view is currently maximized
     */
    isMaximized() {
        return this.maximizedView !== null;
    }

    /**
     * Get the currently maximized view axis
     */
    getMaximizedView() {
        return this.maximizedView;
    }

    /**
     * Cleanup
     */
    dispose() {
        // Cancel any pending renders
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }

        this.removeRoiOverlay();

        // Clean up slice renderers
        Object.values(this.renderers).forEach(renderer => {
            if (renderer) {
                renderer.clearCanvas();
                // Clean up cached resources
                if (renderer.tempCanvas) {
                    renderer.tempCanvas.width = 1;
                    renderer.tempCanvas.height = 1;
                    renderer.tempCanvas = null;
                    renderer.tempCtx = null;
                }
                renderer.cachedImageData = null;
            }
        });

        // Clean up 3D renderer
        if (this.renderer3D) {
            this.renderer3D.dispose();
            this.renderer3D = null;
        }

        this.volumeData = null;
        this.progressiveVolume = null;
        this.lowResVolume = null;
    }
}
