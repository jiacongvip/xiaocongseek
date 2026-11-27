/** Minimal ambient typing for the Electron builtin this plugin uses at runtime.
 *  The module only resolves inside the Electron main process; tsdown keeps it
 *  external so the bundle never embeds it. */
declare module 'electron' {
  export const app: {
    getVersion(): string
  }
}
