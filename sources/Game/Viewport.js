import { Events } from './Events.js'

// Knows how big the game area is and tells everyone when it changes
// (window resized, phone rotated...).
export class Viewport
{
    constructor(domElement)
    {
        this.domElement = domElement

        this.events = new Events()

        this.measure()
        this.setResize()
    }

    measure()
    {
        const bounding = this.domElement.getBoundingClientRect()

        this.width = bounding.width
        this.height = bounding.height
        this.ratio = this.width / this.height

        // Retina screens have more physical pixels than CSS pixels.
        // Rendering all of them is expensive, so we cap it at 2.
        this.pixelRatioPure = window.devicePixelRatio
        this.pixelRatioMax = 2
        this.pixelRatio = Math.min(this.pixelRatioPure, this.pixelRatioMax)
    }

    setResize()
    {
        addEventListener('resize', () =>
        {
            this.measure()
            this.events.trigger('change')
        })
    }
}
