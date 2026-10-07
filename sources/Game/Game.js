import * as THREE from 'three/webgpu'

import { Ticker } from './Ticker.js'
import { Viewport } from './Viewport.js'
import { Rendering } from './Rendering.js'
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
        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color('#1b2a41')
        this.ticker = new Ticker()
        this.viewport = new Viewport(this.domElement)

        // TEMPORARY camera. Step 3 replaces it with a proper View class.
        this.camera = new THREE.PerspectiveCamera(40, this.viewport.ratio, 0.1, 200)
        this.camera.position.set(4, 3, 6)
        this.camera.lookAt(0, 0, 0)
        this.viewport.events.on('change', () =>
        {
            this.camera.aspect = this.viewport.ratio
            this.camera.updateProjectionMatrix()
        })

        // The renderer must be ready before anything can be drawn
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        // Content
        this.world = new World()

        // Start drawing
        this.rendering.start()
    }
}
