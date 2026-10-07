import { Events } from './Events.js'

// The heartbeat. Once per screen refresh it works out how much time has
// passed and announces a 'tick'. Every system in the game listens to it.
export class Ticker
{
    constructor()
    {
        this.elapsed = 0 // Seconds since the page started
        this.delta = 1 / 60 // Seconds since the previous tick
        this.maxDelta = 1 / 30 // Never let one tick be longer than this

        this.events = new Events()
    }

    update(elapsed)
    {
        // The renderer gives us milliseconds
        const elapsedSeconds = elapsed / 1000

        // If the tab was hidden for 10 seconds we do not want a 10 second step
        this.delta = Math.min(elapsedSeconds - this.elapsed, this.maxDelta)
        this.elapsed = elapsedSeconds

        this.events.trigger('tick')
    }
}
