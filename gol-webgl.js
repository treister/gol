class GameOfLifeWebGL {
    constructor() {
        this.isPaused = false;
        this.lastResetTime = Date.now();
        this.cellSize = 4;
        this.hue = 0;
        this.lastInfoTime = 0;
        this.init();
    }

    init() {
        this.canvas = document.getElementById('gameCanvas');
        this.gl = this.canvas.getContext('webgl2');
        
        if (!this.gl) {
            alert('WebGL2 not supported! Please use a modern browser.');
            return;
        }

        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        this.createShaders();
        this.createBuffers();
        this.reset();
        this.render();
    }

    createShaders() {
        // Vertex shader
        const vsSource = `#version 300 es
            in vec2 position;
            out vec2 uv;
            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
                uv = position * 0.5 + 0.5;
            }
        `;

        // Fragment shader
        const fsSource = `#version 300 es
            precision highp float;
            uniform sampler2D state;
            uniform vec2 resolution;
            in vec2 uv;
            out vec4 fragColor;
            
            void main() {
                vec2 texel = floor(uv * resolution);
                float cell = texture(state, texel / resolution).r;
                fragColor = cell > 0.5 ? vec4(0.0, 0.8, 0.4, 1.0) : vec4(0.1, 0.1, 0.1, 1.0);
            }
        `;

        // Create shader program
        const vertexShader = this.compileShader(vsSource, this.gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fsSource, this.gl.FRAGMENT_SHADER);
        this.program = this.createProgram(vertexShader, fragmentShader);
        
        // Get locations
        this.positionLocation = this.gl.getAttribLocation(this.program, 'position');
        this.resolutionLocation = this.gl.getUniformLocation(this.program, 'resolution');
        this.stateLocation = this.gl.getUniformLocation(this.program, 'state');
    }

    compileShader(source, type) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program link error:', this.gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    createBuffers() {
        // Create vertex buffer for full-screen quad
        const vertices = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            -1, 1,
            1, -1,
            1, 1
        ]);

        this.vertexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

        // Create textures for ping-pong rendering
        this.textures = [
            this.createTexture(),
            this.createTexture()
        ];
    }

    createTexture() {
        const texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D, 0, this.gl.R8,
            this.width, this.height, 0,
            this.gl.RED, this.gl.UNSIGNED_BYTE,
            null
        );
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
        return texture;
    }

    resize() {
        const scale = window.devicePixelRatio;
        this.canvas.width = window.innerWidth * scale;
        this.canvas.height = window.innerHeight * scale;
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        
        this.width = Math.floor(this.canvas.width / this.cellSize);
        this.height = Math.floor(this.canvas.height / this.cellSize);
        
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            this.createBuffers();
        }
    }

    reset() {
        const state = new Uint8Array(this.width * this.height);
        for (let i = 0; i < state.length; i++) {
            state[i] = Math.random() > 0.5 ? 255 : 0;
        }
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D, 0, this.gl.R8,
            this.width, this.height, 0,
            this.gl.RED, this.gl.UNSIGNED_BYTE,
            state
        );
    }

    render = () => {
        // Similar info overlay and reset logic as WebGPU version
        const currentTime = Date.now();
        if (currentTime - this.lastResetTime > 30000) {
            this.lastResetTime = currentTime;
            this.cellSize = Math.floor(Math.random() * 8) + 2;
            this.resize();
        }

        if (currentTime - this.lastInfoTime > 5000) {
            this.lastInfoTime = currentTime;
            this.showInfo();
        }

        // Render frame
        this.gl.useProgram(this.program);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.enableVertexAttribArray(this.positionLocation);
        this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.uniform2f(this.resolutionLocation, this.width, this.height);
        
        // Ping-pong between textures
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]);
        [this.textures[0], this.textures[1]] = [this.textures[1], this.textures[0]];
        
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        
        requestAnimationFrame(this.render);
    }

    showInfo() {
        // Same as WebGPU version
        const messages = [
            "Conway's Game of Life, created by mathematician John Conway in 1970, is one of the earliest examples of cellular automata.",
            "The rules are simple: cells live or die based on their neighbors. Too few or too many neighbors cause death, while just the right amount allows survival.",
            "This simulation has been used to teach programming concepts for decades, demonstrating how complex patterns can emerge from simple rules.",
            "Each cell follows just 3 rules: Underpopulation, Overpopulation, and Reproduction.",
            "Try to spot common patterns like 'gliders', 'blinkers', and 'still lifes' in the simulation!"
        ];

        const overlay = document.getElementById('infoOverlay');
        const content = overlay.querySelector('.info-content');
        content.textContent = messages[Math.floor(Math.random() * messages.length)];
        overlay.style.display = 'block';
        
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 5000);
    }
}

new GameOfLifeWebGL(); 