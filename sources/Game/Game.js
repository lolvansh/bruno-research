import * as THREE from 'three/webgpu'

import { Ticker } from './Ticker.js'
import { Viewport } from './Viewport.js'
import { View } from './View.js'
import { Rendering } from './Rendering.js'
import { LoadingScreen } from './LoadingScreen.js'
import { ResourcesLoader } from './ResourcesLoader.js'
import { Materials } from './Materials.js'
import { Lighting } from './Lighting.js'
import { World } from './World/World.js'

// The one object that owns everything. Any other class can get it with
// Game.getInstance() instead of passing it around (same pattern as Bruno).
export class Game
{
    static getInstance()
    {
        return Game.instance
    }

    constructor()
    {
        // Singleton: a second `new Game()` returns the first one
        if(Game.instance)
            return Game.instance

        Game.instance = this

        this.init()
    }

    async init()
    {
        // DOM
        this.domElement = document.querySelector('.game')
        this.canvasElement = this.domElement.querySelector('.js-canvas')

        // Core
        this.loadingScreen = new LoadingScreen()
        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color('#1b2a41')
        this.ticker = new Ticker()
        this.viewport = new Viewport(this.domElement)

        // The camera lives inside View. Needs the scene, ticker and viewport above.
        this.view = new View()

        // The renderer must be ready before anything can be drawn
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        // Load everything the world needs, moving the loading bar as files arrive
        this.resourcesLoader = new ResourcesLoader()
        this.resources = await this.resourcesLoader.load(
            [
                [ 'paletteTexture', 'palette.png', 'texture', (resource) =>
                {
                    resource.colorSpace = THREE.SRGBColorSpace // The image holds sRGB colours
                    resource.minFilter = THREE.NearestFilter // Never blend neighbouring swatches...
                    resource.magFilter = THREE.NearestFilter // ...when zoomed out or in
                    resource.generateMipmaps = false // Mipmaps are blurred copies: they would blend swatches too
                } ],
                [ 'benchesModel', 'benches/benches.glb', 'gltf' ],
            ],
            (toLoad, total) =>
            {
                this.loadingScreen.setProgress(1 - toLoad / total)
            }
        )

        // Now the resources exist, so the systems that use them can be built
        this.materials = new Materials()
        this.lighting = new Lighting()

        // Content
        this.world = new World()

        // Start drawing, and uncover the game
        this.rendering.start()
        this.loadingScreen.hide()
    }
}
