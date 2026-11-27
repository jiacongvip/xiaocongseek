import { defineConfig } from 'tsdown'

/**
 * Node-only host half. The tsc-emitted tree is bundled into one self-contained
 * lib/index.js so the desktop shell loads the MCP server without resolving any
 * runtime dependency at boot.
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
    // Self-contained: the desktop shell resolves nothing at boot for this package.
    noExternal: [/@modelcontextprotocol/, /^zod$/],
  },
])
