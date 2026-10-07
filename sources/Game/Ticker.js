import { Events } from './Events.js'

// The heartbeat. Once per screen refresh it works out how much time has
// passed and announces a 'tick'. Every system in the game listens to it.
export class Ticker
{
    constructor()
    {
        this.elapsed = 0 // Seconds since the page started (real time)
        this.delta = 1 / 60 // Seconds since the previous tick (real time)
        this.maxDelta = 1 / 30 // Never let one tick be longer than this

        // The GAME clock runs 2x faster than the real one (same as Bruno).
        // Physics uses it, which is why his car feels quick and snappy.
        // Use `delta` for things tied to the screen (camera easing),
        // and `deltaScaled` for things in the world (physics, driving).
        this.scale = 2
        this.deltaScaled = this.delta * this.scale
        this.elapsedScaled = 0

        // Average of the last 30 frames. A steadier number than one frame.
        this.lastDeltas = []
        this.deltaAverage = this.delta

        this.events = new Events()
    }

    update(elapsed)
    {
        // The renderer gives us milliseconds
        const elapsedSeconds = elapsed / 1000

        // If the tab was hidden for 10 seconds we do not want a 10 second step
        this.delta = Math.min(elapsedSeconds - this.elapsed, this.maxDelta)
        this.elapsed = elapsedSeconds

        this.deltaScaled = this.delta * this.scale
        this.elapsedScaled += this.deltaScaled

        this.lastDeltas.unshift(this.delta)
        if(this.lastDeltas.length > 30)
            this.lastDeltas.length = 30

        this.deltaAverage = this.lastDeltas.reduce((total, value) => total + value) / this.lastDeltas.length

        this.events.trigger('tick')
    }
}
