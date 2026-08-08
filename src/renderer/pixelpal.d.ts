import type { PixelPalApi } from '../preload/index';

declare global {
  interface Window {
    pixelpal: PixelPalApi;
  }
}

export {};
