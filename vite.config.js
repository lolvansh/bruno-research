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
        sourcemap: false
    }
}
