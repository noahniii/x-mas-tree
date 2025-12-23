import { Component, ElementRef, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

declare const p5: any;

// --- GLSL Shaders ---
// Vertex Shader: Standard MVP with pass-throughs
const vertShader = `
  attribute vec3 aPosition;
  attribute vec2 aTexCoord;
  
  uniform mat4 uModelViewMatrix;
  uniform mat4 uProjectionMatrix;
  
  varying vec2 vTexCoord;
  varying vec3 vPos;

  void main() {
    vTexCoord = aTexCoord;
    vPos = aPosition;
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
  }
`;

// Fragment Shader: High-Contrast Gradient + Halftone Dots
const fragShader = `
  precision mediump float;

  varying vec2 vTexCoord;
  
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform float uDotSize;
  uniform vec2 uResolution;
  
  void main() {
    // 1. Dynamic Gradient (Diagonal mix for more visual interest on blocks)
    // Mixing based on both X and Y coordinates of the texture
    float mixFactor = (vTexCoord.y + vTexCoord.x) * 0.5;
    vec3 gradient = mix(uColor1, uColor2, mixFactor);

    // 2. Screen Space Halftone Pattern
    // We use gl_FragCoord to ensure dots stay screen-aligned while object moves
    vec2 st = gl_FragCoord.xy;
    
    // Rotate grid 45 degrees for classic print look
    float angle = 0.785; 
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    st = rot * st;
    
    // Create grid
    vec2 grid = fract(st / uDotSize) - 0.5;
    float dist = length(grid);
    
    // Dot pattern (Circle shape)
    // We use smoothstep for slightly softer anti-aliased edges
    float pattern = smoothstep(0.4, 0.35, dist); 
    
    // 3. Composition
    // We brighten the base gradient slightly where dots are present to create "ink" feel
    // Or in this reverse style: colorful dots on slightly darker BG, or light dots on color.
    // Let's do: Color Gradient Background with subtle Lighter Halftone overlay to pop.
    
    vec3 finalColor = gradient * (0.9 + (0.3 * pattern)); // Dots are brighter highlights

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

interface TreeBlock {
  x: number;
  y: number;
  z: number;
  w: number; // width (x-axis local)
  h: number; // height (y-axis local)
  d: number; // depth (z-axis local)
  angleY: number; // Main orbit angle
  rotationX: number; // Random tilt
  rotationZ: number; // Random tilt
  phase: number;
  colorPair: { c1: number[], c2: number[] };
  floatSpeed: number;
  rotSpeed: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styles: []
})
export class AppComponent implements OnInit, OnDestroy {
  canvasContainer = viewChild<ElementRef>('canvasContainer');
  
  private p5Instance: any;
  private treeBlocks: TreeBlock[] = [];
  private myShader: any;
  
  // UI State
  isGenerating = signal(false);
  currentStyle = signal('Deconstructed Bauhaus');
  
  // Interaction State
  zoomLevel = 1.0;

  ngOnInit() {
    this.initP5();
  }

  ngOnDestroy() {
    if (this.p5Instance) {
      this.p5Instance.remove();
    }
  }

  rebuildTree() {
    this.isGenerating.set(true);
    // Tiny delay to allow UI to update before heavy calculation (though this is fast)
    setTimeout(() => {
      if (this.p5Instance) {
        this.generateTreeData(this.p5Instance);
      }
      this.isGenerating.set(false);
    }, 50);
  }

  private initP5() {
    const sketch = (p: any) => {
      p.setup = () => {
        const container = this.canvasContainer()?.nativeElement;
        const w = container.offsetWidth;
        const h = container.offsetHeight;
        p.createCanvas(w, h, p.WEBGL);
        
        this.myShader = p.createShader(vertShader, fragShader);
        
        this.updateCamera(p);
        this.generateTreeData(p);
      };

      p.windowResized = () => {
        const container = this.canvasContainer()?.nativeElement;
        p.resizeCanvas(container.offsetWidth, container.offsetHeight);
        this.updateCamera(p);
      };

      p.mouseWheel = (event: any) => {
        // Custom Zoom Logic for Orthographic view
        // p5 orbitControl zoom moves camera Z, which doesn't affect Ortho scale.
        // So we implement manual scaling.
        const zoomSensitivity = 0.001;
        this.zoomLevel -= event.delta * zoomSensitivity;
        this.zoomLevel = p.constrain(this.zoomLevel, 0.2, 5.0); // Clamp zoom
        
        // Prevent default browser scrolling
        return false;
      };

      p.draw = () => {
        // Dark Background for Neon Contrast
        p.background(20, 20, 25); 
        
        // Interactive Orbit (Rotate only mostly)
        // Note: orbitControl zoom is effectively ignored due to Ortho projection mechanics,
        // but we keep it for Rotation interactions.
        p.orbitControl(2, 2, 0); 

        p.shader(this.myShader);
        
        const t = p.millis() * 0.001;
        
        this.myShader.setUniform('uResolution', [p.width, p.height]);
        // Larger dots for bold graphic style
        this.myShader.setUniform('uDotSize', 6.0); 

        p.push();
        
        // Apply Custom Zoom
        p.scale(this.zoomLevel);

        // Global slow rotation of the entire sculpture
        p.rotateY(t * 0.15); 

        p.noStroke();
        
        for (const block of this.treeBlocks) {
          p.push();
          
          // 1. Position & Floating Motion
          // Floating is vertical (y) and slightly radial (z)
          const floatY = Math.sin(t * block.floatSpeed + block.phase) * 8.0; 
          
          p.translate(block.x, block.y + floatY, block.z);
          
          // 2. Rotation
          // Base orientation + Slow self-rotation
          p.rotateY(block.angleY + (t * block.rotSpeed));
          p.rotateX(block.rotationX + (Math.sin(t + block.phase) * 0.02)); // Subtle wobble
          p.rotateZ(block.rotationZ);

          // 3. Color Uniforms
          this.myShader.setUniform('uColor1', block.colorPair.c1);
          this.myShader.setUniform('uColor2', block.colorPair.c2);

          // 4. Draw Block
          p.box(block.w, block.h, block.d);
          
          p.pop();
        }

        p.pop(); 
      };
    };

    const container = this.canvasContainer()?.nativeElement;
    this.p5Instance = new p5(sketch, container);
  }

  private updateCamera(p: any) {
    const w = p.width;
    const h = p.height;
    const aspect = w / h;
    
    // Adjusted visual volume for the taller, more abstract composition
    const treeVisualHeight = 1200; 
    const treeVisualWidth = 1000;

    let orthoH, orthoW;

    if (aspect > 1) {
      orthoH = treeVisualHeight;
      orthoW = orthoH * aspect;
    } else {
      orthoW = treeVisualWidth;
      orthoH = orthoW / aspect;
    }

    // Orthographic projection creates the "Isometric/2.5D" look
    p.ortho(-orthoW / 2, orthoW / 2, -orthoH / 2, orthoH / 2, -5000, 5000);
  }

  private generateTreeData(p: any) {
    this.treeBlocks = [];
    
    // Seed for reproducibility if needed, though we want random on button click
    const seed = p.floor(p.random(99999));
    p.randomSeed(seed);

    // --- Ultra-Vivid Palettes ---
    // High saturation, high brightness. RGB 0.0-1.0
    const palettes = [
      { c1: [1.0, 0.0, 0.3], c2: [1.0, 0.6, 0.0] }, // Neon Red -> Bright Orange
      { c1: [0.0, 0.8, 1.0], c2: [0.0, 0.2, 0.9] }, // Cyan -> Royal Blue
      { c1: [0.8, 1.0, 0.0], c2: [0.0, 0.8, 0.4] }, // Lemon Lime -> Emerald
      { c1: [1.0, 0.0, 1.0], c2: [0.4, 0.0, 1.0] }, // Magenta -> Deep Purple
      { c1: [0.0, 0.9, 0.8], c2: [0.0, 1.0, 0.4] }, // Turquoise -> Spring Green
      { c1: [1.0, 0.8, 0.0], c2: [1.0, 0.2, 0.5] }, // Golden Yellow -> Hot Pink
    ];

    const mode = p.random(['Deconstructed Slab', 'Floating Strips', 'Radial Chaos']);
    this.currentStyle.set(mode);

    // Dimensions for the overall tree shape
    const treeHeight = 700;
    const maxRadius = 350;
    
    // We will generate blocks in a conical volume, but loosely
    const numBlocks = p.floor(p.random(60, 90)); // Many blocks for density

    for (let i = 0; i < numBlocks; i++) {
      // Normalized height 0 (bottom) to 1 (top)
      // Use pow to cluster slightly more at bottom or top depending on power
      // Using slight curve to fill bottom more
      const level = Math.pow(p.random(), 0.8); 
      
      const y = p.map(level, 0, 1, treeHeight/2, -treeHeight/2);
      
      // Conical constraint with noise
      const maxRAtHeight = p.map(level, 0, 1, maxRadius, 20);
      const r = p.random(0, maxRAtHeight);
      const theta = p.random(p.TWO_PI);

      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);

      // --- Geometry: Thick Rectangular Blocks ---
      // We want varied shapes: some long strips, some flat plates, some thick bricks
      const shapeType = p.random();
      let w, h, d;

      if (shapeType < 0.4) {
        // Long Horizontal Strip
        w = p.random(60, 180);
        h = p.random(15, 30);
        d = p.random(15, 30);
      } else if (shapeType < 0.7) {
        // Flat Slab/Plate
        w = p.random(40, 100);
        h = p.random(10, 20);
        d = p.random(40, 100);
      } else {
        // Vertical Chunk/Pillar
        w = p.random(20, 50);
        h = p.random(60, 120);
        d = p.random(20, 50);
      }

      // Add Block
      this.treeBlocks.push({
        x, y, z,
        w, h, d,
        angleY: p.random(p.TWO_PI), // Random initial orientation
        rotationX: p.random(-0.4, 0.4), // Slight chaotic tilt
        rotationZ: p.random(-0.4, 0.4), // Slight chaotic tilt
        phase: p.random(p.TWO_PI), // For animation offset
        colorPair: p.random(palettes),
        floatSpeed: p.random(0.5, 2.0),
        rotSpeed: p.random(-0.3, 0.3)
      });
    }

    // --- Topper: An Abstract Cluster ---
    // Instead of a star, a cluster of bright cubes at the top
    const topperColor = { c1: [1.0, 1.0, 0.0], c2: [1.0, 1.0, 1.0] }; // Pure Yellow/White
    for(let k=0; k<5; k++) {
       this.treeBlocks.push({
        x: p.random(-20, 20), 
        y: -treeHeight/2 - 40, 
        z: p.random(-20, 20),
        w: 30, h: 30, d: 30,
        angleY: p.random(p.TWO_PI),
        rotationX: p.random(p.PI),
        rotationZ: p.random(p.PI),
        phase: p.random(p.TWO_PI),
        colorPair: topperColor,
        floatSpeed: 2.0,
        rotSpeed: 1.0
      });
    }
  }
}