import * as THREE from 'three/webgpu'

import { Ticker } from './Ticker.js'
import { Viewport } from './Viewport.js'
import { View } from './View.js'
import { Rendering } from './Rendering.js'
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
        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color('#1b2a41')
        this.ticker = new Ticker()
        this.viewport = new Viewport(this.domElement)

        // The camera lives inside View. Needs the scene, ticker and viewport above.
        this.view = new View()

        // The renderer must be ready before anything can be drawn
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        // Materials need the palette image, so wait for it
        this.materials = new Materials()
        await this.materials.load()
        this.lighting = new Lighting()

        // Content
        this.world = new World()

        // Start drawing
        this.rendering.start()
    }
}
