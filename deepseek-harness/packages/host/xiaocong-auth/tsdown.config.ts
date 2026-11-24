import { defineConfig } from 'tsdown'

/**
 * Node-only host half. Route paths and wire payload types are re-exported from
 * the tsc-emitted tree so the browser package can share them without pulling in
 * the Host implementation.
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
  },
])
