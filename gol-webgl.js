// Constants
const CELL_SIZE = 4;
const DEBUG_INTERVAL = 5000; // Log debug info every 5 seconds
const RESET_INTERVAL = 30000; // Reset simulation every 30 seconds

class GameOfLifeGL {
    constructor() {
        this.cellSize = 4;
        this.defaultCellSize = 4; // Store default size
        this.minCellSize = 1; // Minimum zoom level
        this.frameCount = 0;
        this.lastInfoTime = 0;
        this.lastResetTime = Date.now();
        this.isPaused = false;
        this.hue = Math.random() * 60 + 120; // Random hue between 120 (green) and 180 (blue)
        this.init();
        this.setupControls();
    }

    setupControls() {
        // Handle mouse wheel for zoom
        this.canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            
            // Calculate new cell size based on scroll direction
            const delta = Math.sign(event.deltaY);  // Reversed from original
            const newCellSize = Math.max(1, 
                                       Math.min(this.cellSize + delta, this.defaultCellSize));
            
            if (newCellSize !== this.cellSize) {
                this.cellSize = newCellSize;
                this.resize();
            }
        });

        // Handle click to pause
        this.canvas.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
        });
    }

    async init() {
        // Setup canvas
        this.canvas = document.getElementById('gameCanvas');
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Get WebGL context
        this.gl = this.canvas.getContext('webgl', { antialias: false });
        if (!this.gl) {
            console.error('WebGL not supported');
            return;
        }

        // Calculate grid dimensions
        this.width = Math.floor(this.canvas.width / this.cellSize);
        this.height = Math.floor(this.canvas.height / this.cellSize);

        // Create two shaders - one for rendering and one for simulation
        const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, `
            attribute vec2 position;
            varying vec2 uv;
            void main() {
                uv = position * 0.5 + 0.5;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `);

        // Simulation shader
        const simulationShader = this.compileShader(this.gl.FRAGMENT_SHADER, `
            precision mediump float;
            uniform sampler2D state;
            uniform vec2 scale;
            varying vec2 uv;

            int getCell(vec2 offset) {
                vec2 coord = fract(uv + offset * scale);
                return texture2D(state, coord).r > 0.5 ? 1 : 0;
            }

            void main() {
                int sum = 
                    getCell(vec2(-1.0, -1.0)) +
                    getCell(vec2(-1.0,  0.0)) +
                    getCell(vec2(-1.0,  1.0)) +
                    getCell(vec2( 0.0, -1.0)) +
                    getCell(vec2( 0.0,  1.0)) +
                    getCell(vec2( 1.0, -1.0)) +
                    getCell(vec2( 1.0,  0.0)) +
                    getCell(vec2( 1.0,  1.0));

                float current = texture2D(state, uv).r;
                float alive = current;

                if (current > 0.5) {
                    // Cell is alive
                    alive = float(sum == 2 || sum == 3);
                } else {
                    // Cell is dead
                    alive = float(sum == 3);
                }

                gl_FragColor = vec4(alive, alive, alive, 1.0);
            }
        `);

        // Render shader
        const renderShader = this.compileShader(this.gl.FRAGMENT_SHADER, `
            precision mediump float;
            uniform sampler2D state;
            uniform float hue;

            // HSL to RGB conversion
            vec3 hsl2rgb(float h, float s, float l) {
                float c = (1.0 - abs(2.0 * l - 1.0)) * s;
                float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
                float m = l - c/2.0;
                vec3 rgb;
                
                if (h < 60.0) rgb = vec3(c, x, 0.0);
                else if (h < 120.0) rgb = vec3(x, c, 0.0);
                else if (h < 180.0) rgb = vec3(0.0, c, x);
                else if (h < 240.0) rgb = vec3(0.0, x, c);
                else if (h < 300.0) rgb = vec3(x, 0.0, c);
                else rgb = vec3(c, 0.0, x);
                
                return rgb + m;
            }

            varying vec2 uv;
            void main() {
                float alive = texture2D(state, uv).r;
                vec3 cellColor = hsl2rgb(hue, 0.8, 0.4);
                gl_FragColor = alive > 0.5 ? vec4(cellColor, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
            }
        `);

        // Create programs and cache uniform locations
        this.simulationProgram = this.createProgram(vertexShader, simulationShader);
        this.renderProgram = this.createProgram(vertexShader, renderShader);

        // Cache uniform locations
        this.uniforms = {
            simulation: {
                state: this.gl.getUniformLocation(this.simulationProgram, 'state'),
                scale: this.gl.getUniformLocation(this.simulationProgram, 'scale')
            },
            render: {
                state: this.gl.getUniformLocation(this.renderProgram, 'state'),
                hue: this.gl.getUniformLocation(this.renderProgram, 'hue')
            }
        };

        // Create vertex buffer
        const vertices = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        this.vertexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

        // Create textures and framebuffers
        this.textures = [
            this.createTexture(),
            this.createTexture()
        ];

        this.framebuffers = this.textures.map(texture => {
            const fb = this.gl.createFramebuffer();
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
            this.gl.framebufferTexture2D(
                this.gl.FRAMEBUFFER,
                this.gl.COLOR_ATTACHMENT0,
                this.gl.TEXTURE_2D,
                texture,
                0
            );
            return fb;
        });

        // Initialize state
        this.reset();

        // Start animation
        requestAnimationFrame(this.render);

        // Add resize listener
        window.addEventListener('resize', () => this.resize());
    }

    compileShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
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
            console.error('Program linking error:', this.gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    createTexture() {
        const texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGBA,
            this.width,
            this.height,
            0,
            this.gl.RGBA,
            this.gl.UNSIGNED_BYTE,
            null
        );
        
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        return texture;
    }

    reset() {
        // Generate new random hue between green (120) and blue (180)
        this.hue = Math.random() * 60.0 + 120.0;
        
        const state = new Uint8Array(this.width * this.height * 4);
        for (let i = 0; i < this.width * this.height; i++) {
            const value = Math.random() > 0.5 ? 255 : 0;
            const idx = i * 4;
            state[idx] = value;     // R
            state[idx + 1] = value; // G
            state[idx + 2] = value; // B
            state[idx + 3] = 255;   // A
        }

        this.textures.forEach(texture => {
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA,
                this.width,
                this.height,
                0,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                state
            );
        });
    }

    showInfo() {
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

    render = () => {
        if (this.isPaused) {
            requestAnimationFrame(this.render);
            return;
        }
        
        const currentTime = Date.now();
        
        // Show info every 5 seconds
        if (currentTime - this.lastInfoTime > 5000) {
            this.lastInfoTime = currentTime;
            this.showInfo();
        }

        // Reset every 30 seconds with new cell size
        if (currentTime - this.lastResetTime > 30000) {
            this.lastResetTime = currentTime;
            this.cellSize = Math.floor(Math.random() * 8) + 2; // Random size between 2-10
            this.resize();
        }

        // Simulation step
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[1]);
        this.gl.viewport(0, 0, this.width, this.height);
        this.gl.useProgram(this.simulationProgram);

        // Bind input texture to texture unit 0
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]);
        this.gl.uniform1i(this.uniforms.simulation.state, 0);
        this.gl.uniform2f(this.uniforms.simulation.scale, 1.0/this.width, 1.0/this.height);

        const positionLocation = this.gl.getAttribLocation(this.simulationProgram, 'position');
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        // Render step
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.useProgram(this.renderProgram);

        // Bind simulation result to texture unit 1
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[1]);
        this.gl.uniform1i(this.uniforms.render.state, 1);

        const renderPositionLocation = this.gl.getAttribLocation(this.renderProgram, 'position');
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.enableVertexAttribArray(renderPositionLocation);
        this.gl.vertexAttribPointer(renderPositionLocation, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.uniform1f(this.uniforms.render.hue, this.hue);

        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        // Swap buffers
        [this.textures[0], this.textures[1]] = [this.textures[1], this.textures[0]];
        [this.framebuffers[0], this.framebuffers[1]] = [this.framebuffers[1], this.framebuffers[0]];

        // Update debug info
        const debugDiv = document.getElementById('debug-info');
        if (debugDiv) {
            debugDiv.textContent = `Game of Life:
Grid: ${this.width}x${this.height}
FPS: ${Math.round(this.frameCount++ / (performance.now() / 1000))}
Frame: ${this.frameCount}`;
        }

        requestAnimationFrame(this.render);
    }

    resize() {
        const scale = window.devicePixelRatio;
        this.canvas.width = window.innerWidth * scale;
        this.canvas.height = window.innerHeight * scale;
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        
        // Recalculate grid dimensions
        this.width = Math.floor(this.canvas.width / this.cellSize);
        this.height = Math.floor(this.canvas.height / this.cellSize);
        
        // Set the viewport
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        // Recreate textures and framebuffers with new size
        if (this.textures) {
            // Cleanup existing textures and framebuffers
            this.textures.forEach(texture => this.gl.deleteTexture(texture));
            this.framebuffers.forEach(fb => this.gl.deleteFramebuffer(fb));
            
            // Create new textures and framebuffers
            this.textures = [
                this.createTexture(),
                this.createTexture()
            ];
            
            this.framebuffers = this.textures.map(texture => {
                const fb = this.gl.createFramebuffer();
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
                this.gl.framebufferTexture2D(
                    this.gl.FRAMEBUFFER,
                    this.gl.COLOR_ATTACHMENT0,
                    this.gl.TEXTURE_2D,
                    texture,
                    0
                );
                return fb;
            });
            
            // Reset the simulation with new dimensions
            this.reset();
        }
    }
}

// Initialize
new GameOfLifeGL();
