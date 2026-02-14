/**
 * WebGL2 MIP (Maximum Intensity Projection) Renderer
 * GPU-accelerated volume rendering using 3D textures and ray marching
 */
class WebGLMIPRenderer {
    constructor(canvas, gl) {
        this.canvas = canvas;
        this.gl = gl;

        // Volume state
        this.volumeTexture = null;
        this.volumeDimensions = [1, 1, 1];
        this.volumeLoaded = false;

        // Optional coarse occupancy texture for empty-space skipping
        this.occupancyTexture = null;
        this.occupancyDimensions = [1, 1, 1];
        this.occupancyBlockSize = 0;

        // Quality mode inferred from quality preset selection
        this.qualityMode = 'medium';
        this.stepSize = 0.005;
        this.numSteps = 256;

        // Display parameters (normalized to [0,1])
        this.displayMin = 0.0;
        this.displayMax = 1.0;
        this.gamma = 1.0;

        // Ray marching hard limit for shader loop compatibility
        this.maxShaderSteps = 16384;
        this.enableLowResAA = false;

        // Shader program and uniforms
        this.program = null;
        this.uniforms = null;

        // Initialize WebGL state
        this.initGL();
    }

    /**
     * Initialize WebGL state, compile shaders
     */
    initGL() {
        const gl = this.gl;

        // Create shader program
        this.program = WebGLUtils.createProgram(
            gl,
            WebGLShaders.vertex,
            WebGLShaders.fragment
        );

        if (!this.program) {
            console.error('Failed to create WebGL program');
            return;
        }

        console.log('WebGL MIP shader program created successfully');

        // Get uniform locations and verify they exist
        this.uniforms = WebGLUtils.getUniformLocations(gl, this.program, [
            'uVolume',
            'uOccupancy',
            'uAzimuth',
            'uElevation',
            'uRoll',
            'uDistance',
            'uPan',
            'uDimensions',
            'uDisplayMin',
            'uDisplayMax',
            'uGamma',
            'uEnableLowResAA',
            'uEnableEmptySpaceSkipping',
            'uUseAdvancedRayMarch',
            'uOccupancyDims',
            'uSkipThreshold',
            'uSkipEpsilon',
            'uStepSize',
            'uNumSteps'
        ]);

        // Set up WebGL state
        // Match 2D viewport background (#0A0D13) for consistent panel tone.
        gl.clearColor(10 / 255, 13 / 255, 19 / 255, 1.0);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        // Create empty VAO (required for WebGL2 even without attributes)
        this.vao = gl.createVertexArray();
    }

    /**
     * Upload volume data to GPU as 3D texture
     * @param {VolumeData} volumeData
     */
    uploadVolume(volumeData) {
        const gl = this.gl;
        const [nx, ny, nz] = volumeData.dimensions;

        // Check texture size limits
        if (!WebGLUtils.volumeFitsInTexture(gl, volumeData.dimensions)) {
            console.error('Volume exceeds WebGL texture size limits');
            return false;
        }

        try {
            // Delete existing textures
            if (this.volumeTexture) {
                gl.deleteTexture(this.volumeTexture);
                this.volumeTexture = null;
            }
            if (this.occupancyTexture) {
                gl.deleteTexture(this.occupancyTexture);
                this.occupancyTexture = null;
            }

            // Create 3D volume texture
            this.volumeTexture = gl.createTexture();
            if (!this.volumeTexture) {
                console.error('Failed to create WebGL texture');
                return false;
            }

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);

            // Set texture parameters
            // R8 supports LINEAR filtering natively for smoother MIP rendering.
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            // All data types upload as R8 (uint8) - 1 byte/voxel instead of 4.
            // R8 automatically normalizes [0,255] to [0.0,1.0] in the shader.
            let data;
            const dataType = volumeData.dataType.toLowerCase();

            if (dataType === 'uint8') {
                data = volumeData.data;
            } else {
                data = this.normalizeToUint8(volumeData.data, volumeData.min, volumeData.max);
            }

            const internalFormat = gl.R8;
            const format = gl.RED;
            const type = gl.UNSIGNED_BYTE;

            // Upload texture data
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage3D(
                gl.TEXTURE_3D,
                0,              // mip level
                internalFormat,
                nx, ny, nz,
                0,              // border
                format,
                type,
                data
            );

            // Build/upload occupancy texture for empty-space skipping.
            this.buildAndUploadOccupancyTexture(data, nx, ny, nz);

            // Check for WebGL errors
            const error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('WebGL error after texture upload:', error);
                // Clean up failed textures
                if (this.volumeTexture) {
                    gl.deleteTexture(this.volumeTexture);
                    this.volumeTexture = null;
                }
                if (this.occupancyTexture) {
                    gl.deleteTexture(this.occupancyTexture);
                    this.occupancyTexture = null;
                }
                return false;
            }

            const texMB = (nx * ny * nz / (1024 * 1024)).toFixed(0);
            console.log(`WebGL: Volume texture uploaded ${nx}x${ny}x${nz} (${texMB}MB as R8)`);
            if (this.occupancyTexture) {
                const [ox, oy, oz] = this.occupancyDimensions;
                console.log(`WebGL: Occupancy grid ${ox}x${oy}x${oz} (block=${this.occupancyBlockSize})`);
            }

            // Store dimensions and mark as loaded
            this.volumeDimensions = [nx, ny, nz];
            this.volumeLoaded = true;
            this.enableLowResAA = !!(volumeData.isLowRes || volumeData.isEnhanced);

            // Reset display range to full for uint8 (already normalized in shader)
            this.displayMin = 0.0;
            this.displayMax = 1.0;

            return true;
        } catch (e) {
            console.error('Exception during WebGL texture upload:', e);
            // Clean up on exception
            if (this.volumeTexture) {
                try {
                    gl.deleteTexture(this.volumeTexture);
                } catch (e2) { /* ignore */ }
                this.volumeTexture = null;
            }
            if (this.occupancyTexture) {
                try {
                    gl.deleteTexture(this.occupancyTexture);
                } catch (e2) { /* ignore */ }
                this.occupancyTexture = null;
            }
            return false;
        }
    }

    /**
     * Build a coarse max-intensity occupancy grid and upload it as a 3D R8 texture.
     * @param {Uint8Array} data - normalized volume data in [0,255]
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     */
    buildAndUploadOccupancyTexture(data, nx, ny, nz) {
        const gl = this.gl;
        const maxDim = Math.max(nx, ny, nz);
        const voxelCount = nx * ny * nz;

        // Coarser bricks for larger volumes keep build cost and texture size bounded.
        let blockSize = 8;
        if (maxDim >= 1536 || voxelCount >= 512 * 1024 * 1024) {
            blockSize = 32;
        } else if (maxDim >= 768 || voxelCount >= 128 * 1024 * 1024) {
            blockSize = 16;
        }

        const bx = Math.ceil(nx / blockSize);
        const by = Math.ceil(ny / blockSize);
        const bz = Math.ceil(nz / blockSize);
        const occupancy = new Uint8Array(bx * by * bz);

        const xToBlock = new Uint16Array(nx);
        const yToBlock = new Uint16Array(ny);
        const zToBlock = new Uint16Array(nz);
        for (let x = 0; x < nx; x++) xToBlock[x] = (x / blockSize) | 0;
        for (let y = 0; y < ny; y++) yToBlock[y] = (y / blockSize) | 0;
        for (let z = 0; z < nz; z++) zToBlock[z] = (z / blockSize) | 0;

        const sliceSize = nx * ny;
        const byStride = bx;
        const bzStride = bx * by;

        for (let z = 0; z < nz; z++) {
            const bzIdx = zToBlock[z];
            const zOffset = z * sliceSize;
            const occZOffset = bzIdx * bzStride;

            for (let y = 0; y < ny; y++) {
                const byIdx = yToBlock[y];
                const rowOffset = zOffset + y * nx;
                const occRowOffset = occZOffset + byIdx * byStride;

                for (let x = 0; x < nx; x++) {
                    const bxIdx = xToBlock[x];
                    const occIndex = occRowOffset + bxIdx;
                    const value = data[rowOffset + x];
                    if (value > occupancy[occIndex]) {
                        occupancy[occIndex] = value;
                    }
                }
            }
        }

        this.occupancyTexture = gl.createTexture();
        if (!this.occupancyTexture) {
            console.warn('WebGL: Failed to create occupancy texture, skipping empty-space acceleration');
            this.occupancyDimensions = [1, 1, 1];
            this.occupancyBlockSize = 0;
            return;
        }

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, this.occupancyTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(
            gl.TEXTURE_3D,
            0,
            gl.R8,
            bx,
            by,
            bz,
            0,
            gl.RED,
            gl.UNSIGNED_BYTE,
            occupancy
        );

        this.occupancyDimensions = [bx, by, bz];
        this.occupancyBlockSize = blockSize;
    }

    /**
     * Normalize typed array data to uint8 [0,255] range
     * @param {TypedArray} data
     * @param {number} min - Data minimum
     * @param {number} max - Data maximum
     * @returns {Uint8Array}
     */
    normalizeToUint8(data, min, max) {
        const result = new Uint8Array(data.length);
        const range = max - min;

        if (range === 0) {
            result.fill(0);
            return result;
        }

        const scale = 255 / range;
        for (let i = 0; i < data.length; i++) {
            result[i] = Math.round((data[i] - min) * scale);
        }

        return result;
    }

    /**
     * Set display range for windowing
     * Values are in original data range, converted to normalized
     * @param {number} min - Window low (in data range)
     * @param {number} max - Window high (in data range)
     * @param {number} dataMin - Volume data minimum
     * @param {number} dataMax - Volume data maximum
     */
    setDisplayRange(min, max, dataMin, dataMax) {
        const range = dataMax - dataMin;
        if (range === 0) {
            this.displayMin = 0;
            this.displayMax = 1;
        } else {
            this.displayMin = (min - dataMin) / range;
            this.displayMax = (max - dataMin) / range;
        }
    }

    /**
     * Set gamma correction
     * @param {number} gamma
     */
    setGamma(gamma) {
        this.gamma = gamma;
    }

    /**
     * Set ray marching quality parameters
     * @param {number} numSteps
     * @param {number} stepSize
     */
    setQuality(numSteps, stepSize, qualityMode = null) {
        this.numSteps = Math.max(1, Math.floor(numSteps));
        this.stepSize = Math.max(1e-6, stepSize);

        if (qualityMode === 'low' || qualityMode === 'medium' || qualityMode === 'high') {
            this.qualityMode = qualityMode;
            return;
        }

        // Fallback inference (kept for compatibility with external callers).
        if (this.numSteps >= 2000 || this.stepSize <= 0.001) {
            this.qualityMode = 'high';
        } else if (this.numSteps <= 300 || this.stepSize >= 0.008) {
            this.qualityMode = 'low';
        } else {
            this.qualityMode = 'medium';
        }
    }

    /**
     * Render the volume
     * @param {object} camera - {azimuth, elevation, roll, distance}
     * @param {object} pan - {x, y} screen-space pan offset in pixels
     */
    render(camera, pan = { x: 0, y: 0 }) {
        if (!this.volumeLoaded || !this.program) return;

        const gl = this.gl;

        // Check for context loss
        if (gl.isContextLost()) {
            console.warn('WebGL context is lost, skipping render');
            return;
        }

        try {
            const targetW = Math.max(1, this.canvas.width);
            const targetH = Math.max(1, this.canvas.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, targetW, targetH);

            // Clear
            gl.clear(gl.COLOR_BUFFER_BIT);

            // Use program
            gl.useProgram(this.program);

            // Bind VAO (even though empty, required in WebGL2)
            gl.bindVertexArray(this.vao);

            // Bind volume texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
            gl.uniform1i(this.uniforms.uVolume, 0);

            // Bind occupancy texture if available
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_3D, this.occupancyTexture || this.volumeTexture);
            gl.uniform1i(this.uniforms.uOccupancy, 1);

            // Set camera uniforms (convert degrees to radians)
            gl.uniform1f(this.uniforms.uAzimuth, camera.azimuth * Math.PI / 180);
            gl.uniform1f(this.uniforms.uElevation, camera.elevation * Math.PI / 180);
            gl.uniform1f(this.uniforms.uRoll, (camera.roll || 0) * Math.PI / 180);
            gl.uniform1f(this.uniforms.uDistance, camera.distance);

            // Set pan offset (convert from pixels to normalized screen space)
            const canvasW = Math.max(1, this.canvas.width);
            const canvasH = Math.max(1, this.canvas.height);
            const panX = (pan.x / canvasW) * 2.0;
            const panY = -(pan.y / canvasH) * 2.0;  // Flip Y for WebGL coords
            gl.uniform2f(this.uniforms.uPan, panX, panY);

            // Set volume dimensions
            gl.uniform3f(
                this.uniforms.uDimensions,
                this.volumeDimensions[0],
                this.volumeDimensions[1],
                this.volumeDimensions[2]
            );

            // Set display parameters
            gl.uniform1f(this.uniforms.uDisplayMin, this.displayMin);
            gl.uniform1f(this.uniforms.uDisplayMax, this.displayMax);
            gl.uniform1f(this.uniforms.uGamma, this.gamma);
            gl.uniform1f(this.uniforms.uEnableLowResAA, this.enableLowResAA ? 1.0 : 0.0);

            // Empty-space skipping parameters
            const skipEnabled = !!this.occupancyTexture && this.qualityMode === 'high';
            gl.uniform1f(this.uniforms.uEnableEmptySpaceSkipping, skipEnabled ? 1.0 : 0.0);
            gl.uniform1f(this.uniforms.uUseAdvancedRayMarch, this.qualityMode === 'high' ? 1.0 : 0.0);
            gl.uniform3f(
                this.uniforms.uOccupancyDims,
                this.occupancyDimensions[0],
                this.occupancyDimensions[1],
                this.occupancyDimensions[2]
            );
            const skipThreshold = Math.max(0.0, this.displayMin - (1.0 / 255.0));
            gl.uniform1f(this.uniforms.uSkipThreshold, skipThreshold);
            gl.uniform1f(this.uniforms.uSkipEpsilon, 1e-4);

            // Keep low/medium on fixed preset sampling. Only high gets watchdog capping.
            const march = this.getEffectiveRayMarch(targetW, targetH);
            gl.uniform1f(this.uniforms.uStepSize, march.stepSize);
            gl.uniform1i(this.uniforms.uNumSteps, march.numSteps);

            // Draw full-screen quad (6 vertices, 2 triangles)
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Unbind VAO
            gl.bindVertexArray(null);

            // Ensure default framebuffer is bound at exit.
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            // Check for errors after render
            const error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.warn('WebGL error during render:', error);
            }
        } catch (e) {
            console.error('Exception during WebGL render:', e);
            throw e; // Re-throw to trigger fallback in VolumeRenderer3D
        }
    }

    /**
     * Effective ray-march settings. Low/medium stay fixed to preserve fidelity.
     * High quality gets a watchdog cap to avoid GPU hangs on very large canvases.
     * @param {number} targetW
     * @param {number} targetH
     * @returns {{stepSize:number, numSteps:number}}
     */
    getEffectiveRayMarch(targetW, targetH) {
        let stepSize = this.stepSize;
        let numSteps = this.numSteps;

        if (this.qualityMode !== 'high') {
            return {
                stepSize,
                numSteps: Math.max(1, Math.min(this.maxShaderSteps, numSteps))
            };
        }

        const pixelCount = Math.max(1, Math.max(1, targetW) * Math.max(1, targetH));
        const [nx, ny, nz] = this.volumeDimensions;
        const voxelCount = Math.max(1, nx * ny * nz);

        // Very large volumes need stricter caps.
        let maxAllowedSteps = 2048;
        if (voxelCount >= 128 * 1024 * 1024) {
            maxAllowedSteps = (pixelCount >= (1000 * 1000)) ? 1024 : 1400;
        }

        // Device/pixel based budget safeguard.
        {
            const deviceBytes = WebGLUtils.getDeviceMemoryBytes();
            let sampleBudget = 650 * 1024 * 1024;
            if (deviceBytes) {
                const gb = deviceBytes / (1024 * 1024 * 1024);
                if (gb <= 4) sampleBudget = 420 * 1024 * 1024;
                else if (gb <= 8) sampleBudget = 700 * 1024 * 1024;
                else sampleBudget = 1000 * 1024 * 1024;
            }

            const capStepsByBudget = Math.max(1, Math.floor(sampleBudget / pixelCount));
            maxAllowedSteps = Math.min(maxAllowedSteps, capStepsByBudget);
        }

        // Preserve full-ray coverage; if capped below required steps, increase stepSize
        // so the ray still traverses the whole volume (degrade detail, not geometry extent).
        const requiredTravel = 2.0;
        const minCoverageSteps = Math.max(1, Math.ceil(requiredTravel / Math.max(stepSize, 1e-6)));
        const targetSteps = Math.max(64, Math.min(this.maxShaderSteps, Math.floor(maxAllowedSteps)));

        if (targetSteps < minCoverageSteps) {
            numSteps = targetSteps;
            stepSize = requiredTravel / numSteps;
        } else {
            numSteps = Math.min(numSteps, targetSteps);
        }

        numSteps = Math.max(64, Math.min(this.maxShaderSteps, numSteps));
        return { stepSize, numSteps };
    }

    /**
     * Clean up WebGL resources
     */
    dispose() {
        const gl = this.gl;

        if (this.volumeTexture) {
            gl.deleteTexture(this.volumeTexture);
            this.volumeTexture = null;
        }

        if (this.occupancyTexture) {
            gl.deleteTexture(this.occupancyTexture);
            this.occupancyTexture = null;
        }

        if (this.program) {
            gl.deleteProgram(this.program);
            this.program = null;
        }

        if (this.vao) {
            gl.deleteVertexArray(this.vao);
            this.vao = null;
        }

        this.volumeLoaded = false;
    }
}
