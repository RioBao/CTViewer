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
    }
};
