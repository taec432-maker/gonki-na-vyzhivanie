/** Минимальные типы для n8ao (ISC): Ambient Occlusion для pmndrs/postprocessing. */
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import type { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    autoDetectTransparency: boolean;
    configuration: {
      transparencyAware: boolean;
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      halfRes: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      screenSpaceRadius: boolean;
      gammaCorrection: boolean;
      depthAwareUpsampling: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
