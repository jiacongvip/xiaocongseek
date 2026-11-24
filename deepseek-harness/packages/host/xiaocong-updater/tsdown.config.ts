import { defineConfig } from 'tsdown'

/**
 * Node-only host half. The tsc-emitted tree is bundled into one self-contained
 * lib/index.js. `electron` stays external: it only resolves inside the
 * Electron main process, which is exactly where this plugin runs.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['electron'],
  },
])
