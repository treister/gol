/**
 * WebGPU implementation of Conway's Game of Life
 * This simulation uses compute shaders for cellular automata calculations
 * and fragment shaders for visualization with dynamic color transitions.
 * 
 * Features:
 * - Efficient parallel processing using WebGPU compute shaders
 * - Automatic grid size adjustment based on screen size
 * - Periodic informational overlays about the simulation
 * - Dynamic color transitions for living cells
 * - Automatic pattern reset every 30 seconds
 */
const WORKGROUP_SIZE = 8;

class GameOfLife {
    constructor() {
        this.isPaused = false;
        this.lastResetTime = Date.now();
        this.cellSize = 4; // Initial cell size
        this.hue = 0;
        this.lastInfoTime = 0;
        this.init();
    }

    async init() {
        if (!navigator.gpu) {
            alert('WebGPU not supported! Please use Chrome Canary or Edge Canary with WebGPU enabled.');
            return;
        }

        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter.requestDevice();

        // Setup canvas
        this.canvas = document.getElementById('gameCanvas');
        this.context = this.canvas.getContext('webgpu');

        // Set canvas size to match screen
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Configure canvas
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: canvasFormat,
            alphaMode: 'premultiplied',
        });

        await this.createPipelines();
        await this.createBuffers();
        this.render();
    }

    async createPipelines() {
        // Compute shader for game logic
        const computeShaderModule = this.device.createShaderModule({
            label: 'Game of Life compute shader',
            code: `
                @group(0) @binding(0) var<storage, read> input: array<u32>;
                @group(0) @binding(1) var<storage, read_write> output: array<u32>;

                struct Uniforms {
                    width: u32,
                    height: u32,
                };
                @group(0) @binding(2) var<uniform> uniforms: Uniforms;

                fn getCellState(x: u32, y: u32) -> u32 {
                    let width = uniforms.width;
                    let height = uniforms.height;
                    let xWrapped = (x + width) % width;
                    let yWrapped = (y + height) % height;
                    return input[yWrapped * width + xWrapped];
                }

                @compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
                fn computeMain(@builtin(global_invocation_id) global_id: vec3<u32>) {
                    let x = global_id.x;
                    let y = global_id.y;
                    
                    if (x >= uniforms.width || y >= uniforms.height) {
                        return;
                    }

                    var neighbors = 0u;
                    for (var dy = -1; dy <= 1; dy++) {
                        for (var dx = -1; dx <= 1; dx++) {
                            if (dx == 0 && dy == 0) {
                                continue;
                            }
                            neighbors += getCellState(x + u32(dx), y + u32(dy));
                        }
                    }

                    let index = y * uniforms.width + x;
                    let currentState = input[index];
                    
                    if (currentState == 1u) {
                        output[index] = select(0u, 1u, neighbors == 2u || neighbors == 3u);
                    } else {
                        output[index] = select(0u, 1u, neighbors == 3u);
                    }
                }
            `
        });

        // Render shader for visualization
        const renderShaderModule = this.device.createShaderModule({
            label: 'Game of Life render shader',
            code: `
                struct VertexOutput {
                    @builtin(position) position: vec4f,
                    @location(0) cell: vec2f,
                };

                @vertex
                fn vertexMain(@location(0) position: vec2f) -> VertexOutput {
                    var output: VertexOutput;
                    output.position = vec4f(position, 0.0, 1.0);
                    output.cell = position * 0.5 + 0.5;
                    return output;
                }

                @group(0) @binding(0) var<storage> cells: array<u32>;
                @group(0) @binding(1) var<uniform> uniforms: Uniforms;

                struct Uniforms {
                    width: u32,
                    height: u32,
                };

                @fragment
                fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
                    let cell_x = u32(input.cell.x * f32(uniforms.width));
                    let cell_y = u32(input.cell.y * f32(uniforms.height));
                    let index = cell_y * uniforms.width + cell_x;
                    
                    let alive = cells[index] == 1u;
                    return select(vec4f(0.1, 0.1, 0.1, 1.0), vec4f(0.0, 0.8, 0.4, 1.0), alive);
                }
            `
        });

        // Create compute pipeline
        this.computePipeline = this.device.createComputePipeline({
            label: 'Game of Life compute pipeline',
            layout: 'auto',
            compute: {
                module: computeShaderModule,
                entryPoint: 'computeMain',
            }
        });

        // Create render pipeline
        this.renderPipeline = this.device.createRenderPipeline({
            label: 'Game of Life render pipeline',
            layout: 'auto',
            vertex: {
                module: renderShaderModule,
                entryPoint: 'vertexMain',
                buffers: [{
                    arrayStride: 8,
                    attributes: [{
                        format: 'float32x2',
                        offset: 0,
                        shaderLocation: 0,
                    }],
                }],
            },
            fragment: {
                module: renderShaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                }],
            },
        });
    }

    async createBuffers() {
        // Create vertex buffer for full-screen quad
        const vertices = new Float32Array([
            -1, -1,  // Bottom left
            1, -1,   // Bottom right
            -1, 1,   // Top left
            -1, 1,   // Top left (repeated)
            1, -1,   // Bottom right (repeated)
            1, 1,    // Top right
        ]);

        this.vertexBuffer = this.device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

        // Create cell state buffers
        const cellsCount = this.width * this.height;
        this.cellStateBuffers = [
            this.device.createBuffer({
                size: cellsCount * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            this.device.createBuffer({
                size: cellsCount * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
        ];

        // Create uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 16, // 4 bytes each for width, height, hue, and padding
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([this.width, this.height, 0, 0]));

        // Initialize with random state
        this.reset();
    }

    resize() {
        const scale = window.devicePixelRatio;
        this.canvas.width = window.innerWidth * scale;
        this.canvas.height = window.innerHeight * scale;
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        
        // Calculate grid dimensions based on cell size
        this.width = Math.floor(this.canvas.width / this.cellSize);
        this.height = Math.floor(this.canvas.height / this.cellSize);
        
        // Recreate buffers with new size
        if (this.device) {
            this.createBuffers();
        }
    }

    reset() {
        const cellsCount = this.width * this.height;
        const initialState = new Uint32Array(cellsCount);
        for (let i = 0; i < cellsCount; i++) {
            initialState[i] = Math.random() > 0.5 ? 1 : 0;
        }
        this.device.queue.writeBuffer(this.cellStateBuffers[0], 0, initialState);
    }

    setupControls() {
        document.getElementById('pauseButton').onclick = () => {
            this.isPaused = !this.isPaused;
        };
        document.getElementById('resetButton').onclick = () => {
            this.reset();
        };
    }

    render = () => {
        const currentTime = Date.now();
        if (currentTime - this.lastResetTime > 30000) { // 30 seconds
            this.lastResetTime = currentTime;
            this.cellSize = Math.floor(Math.random() * 8) + 2; // Random size between 2-10
            this.resize();
        }

        // Update hue
        this.hue = (this.hue + 0.001) % 1.0;
        this.device.queue.writeBuffer(this.uniformBuffer, 8, new Float32Array([this.hue]));

        // Show info every 5 seconds
        if (currentTime - this.lastInfoTime > 5000) {
            this.lastInfoTime = currentTime;
            this.showInfo();
        }

        // Compute pass
        const commandEncoder = this.device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cellStateBuffers[0] } },
                { binding: 1, resource: { buffer: this.cellStateBuffers[1] } },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
            ],
        }));

        const workgroupsX = Math.ceil(this.width / WORKGROUP_SIZE);
        const workgroupsY = Math.ceil(this.height / WORKGROUP_SIZE);
        computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
        computePass.end();

        // Render pass
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
        });

        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.device.createBindGroup({
            layout: this.renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cellStateBuffers[1] } },
                { binding: 1, resource: { buffer: this.uniformBuffer } },
            ],
        }));
        renderPass.setVertexBuffer(0, this.vertexBuffer);
        renderPass.draw(6, 1, 0, 0);
        renderPass.end();

        this.device.queue.submit([commandEncoder.finish()]);

        // Swap buffers
        [this.cellStateBuffers[0], this.cellStateBuffers[1]] = 
        [this.cellStateBuffers[1], this.cellStateBuffers[0]];

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
        const content = overlay.querySelector('.info-content');
        content.textContent = messages[Math.floor(Math.random() * messages.length)];
        overlay.style.display = 'block';
        
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 5000);
    }
}

new GameOfLife();
