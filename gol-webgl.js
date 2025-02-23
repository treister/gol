class GameOfLifeWebGL {
    constructor() {
        this.isPaused = false;
        this.lastResetTime = Date.now();
        this.cellSize = 4;
        this.hue = 0;
        this.lastInfoTime = 0;
        this.debug = true;
        
        // Add pause/reset controls
        document.addEventListener('keypress', (e) => {
            if (e.key === ' ') {
                this.isPaused = !this.isPaused;
            } else if (e.key === 'r') {
                this.reset();
            }
        });

        this.init();
    }

    init() {
        this.canvas = document.getElementById('gameCanvas');
        this.gl = this.canvas.getContext('webgl2');
        
        if (!this.gl) {
            this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
            if (!this.gl) {
                alert('Neither WebGL2 nor WebGL1 is supported on your browser');
                return;
            }
            console.log('Using WebGL 1 as fallback');
        } else {
            console.log('Using WebGL 2');
        }

        console.log('Canvas dimensions:', this.canvas.width, 'x', this.canvas.height);

        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        try {
            this.createShaders();
            this.createBuffers();
            this.render();
        } catch (e) {
            console.error('Error during initialization:', e);
        }
    }

    checkGLError(where) {
        if (!this.debug) return;
        const err = this.gl.getError();
        if (err !== this.gl.NO_ERROR) {
            console.error(`GL Error at ${where}:`, err);
            console.trace();
        }
    }

    createShaders() {
        const vsSource = `#version 300 es
            in vec2 position;
            out vec2 uv;
            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
                uv = position * 0.5 + 0.5;
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            uniform sampler2D state;
            uniform vec2 resolution;
            in vec2 uv;
            out vec4 fragColor;
            
            int getCell(vec2 coord) {
                vec2 wrappedCoord = mod(coord, resolution) / resolution;
                return texture(state, wrappedCoord).r > 0.5 ? 1 : 0;
            }
            
            void main() {
                vec2 texel = floor(uv * resolution);
                
                // Count live neighbors
                int sum = 0;
                for(int y = -1; y <= 1; y++) {
                    for(int x = -1; x <= 1; x++) {
                        if(x == 0 && y == 0) continue;
                        vec2 offset = texel + vec2(x, y);
                        sum += getCell(offset);
                    }
                }
                
                // Apply Game of Life rules
                int current = getCell(texel);
                float next = 0.0;
                
                if(current == 1) {
                    next = (sum == 2 || sum == 3) ? 1.0 : 0.0;
                } else {
                    next = (sum == 3) ? 1.0 : 0.0;
                }

                // When rendering to framebuffer, store just the state
                if (gl_FragCoord.x <= resolution.x && gl_FragCoord.y <= resolution.y) {
                    fragColor = vec4(next, next, next, 1.0);
                } else {
                    // When rendering to screen, show colors
                    fragColor = next > 0.5 ? 
                        vec4(0.0, 0.8, 0.4, 1.0) :  // Bright green for live cells
                        vec4(0.1, 0.1, 0.1, 1.0);   // Dark gray for dead cells
                }
            }
        `;

        const vertexShader = this.compileShader(vsSource, this.gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fsSource, this.gl.FRAGMENT_SHADER);
        
        this.program = this.createProgram(vertexShader, fragmentShader);

        // Get locations
        this.positionLocation = this.gl.getAttribLocation(this.program, 'position');
        this.stateLocation = this.gl.getUniformLocation(this.program, 'state');
        this.resolutionLocation = this.gl.getUniformLocation(this.program, 'resolution');
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
        // Create vertex buffer
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

        // Create two textures for ping-pong rendering
        this.textures = [
            this.createTexture(),
            this.createTexture()
        ];

        // Create framebuffers
        this.framebuffers = [
            this.createFramebuffer(this.textures[0]),
            this.createFramebuffer(this.textures[1])
        ];

        // Initialize first texture with random state
        const state = new Uint8Array(this.width * this.height * 4);
        for (let i = 0; i < this.width * this.height; i++) {
            const value = Math.random() > 0.5 ? 255 : 0;
            const idx = i * 4;
            state[idx] = value;     // R
            state[idx + 1] = value; // G
            state[idx + 2] = value; // B
            state[idx + 3] = 255;   // A
        }

        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]);
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
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);

        return texture;
    }

    createFramebuffer(texture) {
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
    }

    resize() {
        const scale = window.devicePixelRatio;
        this.canvas.width = window.innerWidth * scale;
        this.canvas.height = window.innerHeight * scale;
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        
        this.width = Math.floor(this.canvas.width / this.cellSize);
        this.height = Math.floor(this.canvas.height / this.cellSize);
        
        console.log('Resized to:', {
            canvas: `${this.canvas.width}x${this.canvas.height}`,
            grid: `${this.width}x${this.height}`
        });
        
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    reset() {
        const state = new Uint8Array(this.width * this.height * 4);
        for (let i = 0; i < this.width * this.height; i++) {
            const value = Math.random() > 0.5 ? 255 : 0;
            const idx = i * 4;
            state[idx] = value;     // R
            state[idx + 1] = value; // G
            state[idx + 2] = value; // B
            state[idx + 3] = 255;   // A
        }
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]);
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
    }

    render = () => {
        if (this.isPaused) {
            requestAnimationFrame(this.render);
            return;
        }

        const currentTime = Date.now();
        if (currentTime - this.lastResetTime > 30000) { // Reset every 30 seconds
            this.lastResetTime = currentTime;
            this.reset();
        }

        if (currentTime - this.lastInfoTime > 5000) { // Show info every 5 seconds
            this.lastInfoTime = currentTime;
            this.showInfo();
        }

        // Step 1: Update simulation (render to framebuffer)
        this.gl.useProgram(this.program);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.enableVertexAttribArray(this.positionLocation);
        this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.uniform2f(this.resolutionLocation, this.width, this.height);
        
        // Bind input texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]);
        this.gl.uniform1i(this.stateLocation, 0);

        // Render to the other texture
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[1]);
        this.gl.viewport(0, 0, this.width, this.height);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        // Step 2: Render to screen
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        // Use updated state
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[1]);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        // Swap textures for next frame
        [this.textures[0], this.textures[1]] = [this.textures[1], this.textures[0]];
        [this.framebuffers[0], this.framebuffers[1]] = [this.framebuffers[1], this.framebuffers[0]];

        requestAnimationFrame(this.render);
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
        if (!overlay) {
            console.error('Info overlay element not found');
            return;
        }
        const content = overlay.querySelector('.info-content');
        if (!content) {
            console.error('Info content element not found');
            return;
        }
        content.textContent = messages[Math.floor(Math.random() * messages.length)];
        overlay.style.display = 'block';
        
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 5000);
    }
}

new GameOfLifeWebGL(); 