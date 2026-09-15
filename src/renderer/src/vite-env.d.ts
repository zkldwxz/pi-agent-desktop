/// <reference types="vite/client" />

import type { PiBridge } from "../../preload/index";

declare global {
  interface Window {
    pi: PiBridge;
  }
}

export {};
