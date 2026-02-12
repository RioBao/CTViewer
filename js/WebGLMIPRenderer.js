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

        // Display parameters (normalized to [0,1])
        this.displayMin = 0.0;
        this.displayMax = 1.0;
        this.gamma = 1.0;

        // Ray marching parameters
        this.stepSize = 0.005;
        this.numSteps = 256;
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
            'uStepSize',
            'uNumSteps'
        ]);

        // Set up WebGL state
        gl.clearColor(0.04, 0.04, 0.04, 1.0);  // Match #0a0a0a background
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
            // Delete existing texture
            if (this.volumeTexture) {
                gl.deleteTexture(this.volumeTexture);
                this.volumeTexture = null;
            }

            // Create 3D texture
            this.volumeTexture = gl.createTexture();
            if (!this.volumeTexture) {
                console.error('Failed to create WebGL texture');
                return false;
            }

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);

            // Set texture parameters
            // R8 supports LINEAR filtering natively — smoother MIP rendering
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            // All data types upload as R8 (uint8) — 1 byte/voxel instead of 4
            // R8 automatically normalizes [0,255] to [0.0,1.0] in the shader
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

            // Check for WebGL errors
            const error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('WebGL error after texture upload:', error);
                // Clean up failed texture
                gl.deleteTexture(this.volumeTexture);
                this.volumeTexture = null;
                return false;
            }

            const texMB = (nx * ny * nz / (1024 * 1024)).toFixed(0);
            console.log(`WebGL: Volume texture uploaded ${nx}x${ny}x${nz} (${texMB}MB as R8)`);

            // Store dimensions and mark as loaded
            this.volumeDimensions = [nx, ny, nz];
            this.volumeLoaded = true;
            this.enableLowResAA = !!(volumeData.isLowRes || volumeData.isEnhanced);

            // Reset display range to full for uint8 (already normalized in shader)
            // For normalized data, displayMin/Max are in [0,1]
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
            return false;
        }
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
    setQuality(numSteps, stepSize) {
        this.numSteps = numSteps;
        this.stepSize = stepSize;
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
            // Update viewport to match canvas size
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);

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

            // Set camera uniforms (convert degrees to radians)
            gl.uniform1f(this.uniforms.uAzimuth, camera.azimuth * Math.PI / 180);
            gl.uniform1f(this.uniforms.uElevation, camera.elevation * Math.PI / 180);
            gl.uniform1f(this.uniforms.uRoll, (camera.roll || 0) * Math.PI / 180);
            gl.uniform1f(this.uniforms.uDistance, camera.distance);

            // Set pan offset (convert from pixels to normalized screen space)
            const panX = (pan.x / this.canvas.width) * 2.0;
            const panY = -(pan.y / this.canvas.height) * 2.0;  // Flip Y for WebGL coords
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

            // Set ray marching parameters
            gl.uniform1f(this.uniforms.uStepSize, this.stepSize);
            gl.uniform1i(this.uniforms.uNumSteps, this.numSteps);

            // Draw full-screen quad (6 vertices, 2 triangles)
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Unbind
            gl.bindVertexArray(null);

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
     * Clean up WebGL resources
     */
    dispose() {
        const gl = this.gl;

        if (this.volumeTexture) {
            gl.deleteTexture(this.volumeTexture);
            this.volumeTexture = null;
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
