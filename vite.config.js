import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default {
    root: 'sources/', // Where index.html lives
    publicDir: '../static/', // Files served as they are (models, textures...)
    base: './', // Relative paths, so the build works in any folder
    server:
    {
        host: true // Also reachable from other devices on the network
    },
    build:
    {
        outDir: '../dist', // Production build goes here
        emptyOutDir: true, // Clean it before each build
        sourcemap: false,
        target: 'esnext' // Modern browsers only. Required so Rapier's top-level `await` is left alone.
    },
    plugins:
    [
        wasm(), // Lets JavaScript import .wasm files (Rapier is a WebAssembly program)
        topLevelAwait() // Rapier's startup uses top-level `await`, which older browsers reject
    ]
}
