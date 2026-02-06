/**
 * WebGL2 Utility Functions
 * Context creation, shader compilation, and error handling
 */
const WebGLUtils = {
    /**
     * Create a WebGL2 context with error handling
     * @param {HTMLCanvasElement} canvas
     * @returns {WebGL2RenderingContext|null}
     */
    createContext(canvas) {
        const gl = canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance'
        });

        if (!gl) {
            console.warn('WebGL2 not available');
            return null;
        }

        return gl;
    },

    /**
     * Compile a shader from source
     * @param {WebGL2RenderingContext} gl
     * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
     * @param {string} source - GLSL source code
     * @returns {WebGLShader|null}
     */
    compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            console.error('Shader compilation error:', info);
            console.error('Shader source:', source);
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    },

    /**
     * Create a shader program from vertex and fragment shaders
     * @param {WebGL2RenderingContext} gl
     * @param {string} vertexSource
     * @param {string} fragmentSource
     * @returns {WebGLProgram|null}
     */
    createProgram(gl, vertexSource, fragmentSource) {
        const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
        if (!vertexShader) return null;

        const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
        if (!fragmentShader) {
            gl.deleteShader(vertexShader);
            return null;
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        // Shaders can be deleted after linking
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            console.error('Program linking error:', info);
            gl.deleteProgram(program);
            return null;
        }

        return program;
    },

    /**
     * Get all uniform locations for a program
     * @param {WebGL2RenderingContext} gl
     * @param {WebGLProgram} program
     * @param {string[]} names - Array of uniform names
     * @returns {Object} Map of name to WebGLUniformLocation
     */
    getUniformLocations(gl, program, names) {
        const locations = {};
        for (const name of names) {
            locations[name] = gl.getUniformLocation(program, name);
        }
        return locations;
    },

    /**
     * Check maximum 3D texture size
     * @param {WebGL2RenderingContext} gl
     * @returns {number}
     */
    getMax3DTextureSize(gl) {
        return gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    },

    /**
     * Check if a volume fits within texture limits
     * @param {WebGL2RenderingContext} gl
     * @param {number[]} dimensions - [width, height, depth]
     * @returns {boolean}
     */
    volumeFitsInTexture(gl, dimensions) {
        const maxSize = this.getMax3DTextureSize(gl);
        return dimensions[0] <= maxSize &&
               dimensions[1] <= maxSize &&
               dimensions[2] <= maxSize;
    },

    /**
     * Estimate GPU memory required for a volume texture
     * @param {number[]} dimensions - [width, height, depth]
     * @param {string} dataType - 'uint8', 'uint16', or 'float32'
     * @returns {object} - { bytes, megabytes, gpuBytes, gpuMegabytes, warning }
     */
    estimateGPUMemory(dimensions, dataType) {
        const [nx, ny, nz] = dimensions;
        const voxelCount = nx * ny * nz;

        // Source data size
        let bytesPerVoxel = 1;
        if (dataType === 'uint16') bytesPerVoxel = 2;
        else if (dataType === 'float32') bytesPerVoxel = 4;
        const sourceBytes = voxelCount * bytesPerVoxel;

        // GPU texture size - all types normalized to R8 (1 byte per voxel)
        const gpuBytesPerVoxel = 1;
        const gpuBytes = voxelCount * gpuBytesPerVoxel;

        // Memory thresholds
        const WARN_THRESHOLD = 512 * 1024 * 1024;  // 512 MB
        const DANGER_THRESHOLD = 1024 * 1024 * 1024; // 1 GB

        let warning = null;
        if (gpuBytes > DANGER_THRESHOLD) {
            warning = 'critical';
        } else if (gpuBytes > WARN_THRESHOLD) {
            warning = 'high';
        }

        return {
            bytes: sourceBytes,
            megabytes: (sourceBytes / (1024 * 1024)).toFixed(1),
            gpuBytes: gpuBytes,
            gpuMegabytes: (gpuBytes / (1024 * 1024)).toFixed(1),
            warning: warning
        };
    },

    /**
     * Check GPU memory and return recommendation
     * @param {WebGL2RenderingContext} gl
     * @param {number[]} dimensions
     * @param {string} dataType
     * @returns {object} - { canLoad, recommendation, memoryInfo }
     */
    checkGPUMemory(gl, dimensions, dataType) {
        const memInfo = this.estimateGPUMemory(dimensions, dataType);
        const fitsTexture = this.volumeFitsInTexture(gl, dimensions);

        let canLoad = fitsTexture;
        let recommendation = null;

        if (!fitsTexture) {
            canLoad = false;
            recommendation = 'Volume exceeds maximum texture size. Use CPU rendering.';
        } else if (memInfo.warning === 'critical') {
            canLoad = true; // Allow but warn
            recommendation = `Volume requires ~${memInfo.gpuMegabytes}MB GPU memory. May cause instability on some systems. Consider using CPU rendering if you experience crashes.`;
        } else if (memInfo.warning === 'high') {
            canLoad = true;
            recommendation = `Volume requires ~${memInfo.gpuMegabytes}MB GPU memory.`;
        }

        return {
            canLoad,
            recommendation,
            memoryInfo: memInfo
        };
    }
};
