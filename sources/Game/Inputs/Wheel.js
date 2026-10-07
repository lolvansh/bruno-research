import { Events } from '../Events.js'

// Adapted from Bruno Simon's folio-2025 Wheel.js (MIT), see LICENSE-THIRD-PARTY.
// He uses the `normalize-wheel` package; we do the same job in three lines.
//
// Announces 'roll' with a number from -1 to 1:
//   about  1 = one notch of a mouse wheel scrolled down
//   about -1 = one notch up
// A trackpad sends many tiny events, so each one gives a small number.
export class Wheel
{
    constructor()
    {
        this.events = new Events()

        addEventListener('wheel', (event) =>
        {
            // Some browsers report lines instead of pixels (about 33 pixels per line)
            const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY

            // A mouse wheel notch is about 100 pixels
            const notches = Math.max(-1, Math.min(1, pixels / 100))

            this.events.trigger('roll', [ notches ])
        }, { passive: true })
    }
}
