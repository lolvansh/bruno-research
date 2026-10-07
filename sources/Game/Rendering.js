import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

// Owns the renderer: the thing that turns the scene + camera into pixels.
export class Rendering
{
    constructor()
    {
        this.game = Game.getInstance()
    }

    async setRenderer()
    {
        // WebGPURenderer uses WebGPU when the browser has it,
        // and quietly falls back to WebGL2 when it does not.
        this.renderer = new THREE.WebGPURenderer({
            canvas: this.game.canvasElement,
            powerPreference: 'high-performance',
            antialias: this.game.viewport.pixelRatio < 2
        })
        this.renderer.setSize(this.game.viewport.width, this.game.viewport.height)
        this.renderer.setPixelRatio(this.game.viewport.pixelRatio)

        // The renderer drives the loop: it calls us once per screen refresh,
        // and we pass that on to the ticker.
        this.renderer.setAnimationLoop((elapsedTime) => { this.game.ticker.update(elapsedTime) })

        // WebGPU has to be set up asynchronously, so the caller must wait
        return this.renderer.init()
    }

    start()
    {
        // Drawing is the LAST thing in a frame (priority 998)
        this.game.ticker.events.on('tick', () =>
        {
            this.render()
        }, 998)

        this.game.viewport.events.on('change', () =>
        {
            this.resize()
        })
    }

    resize()
    {
        this.renderer.setSize(this.game.viewport.width, this.game.viewport.height)
        this.renderer.setPixelRatio(this.game.viewport.pixelRatio)
    }

    render()
    {
        this.renderer.render(this.game.scene, this.game.camera)
    }
}
