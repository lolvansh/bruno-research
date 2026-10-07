import { Events } from '../Events.js'

// Adapted from Bruno Simon's folio-2025 Keyboard.js (MIT), see LICENSE-THIRD-PARTY.
//
// The raw layer: it only announces "this key went down" and "this key went up".
// It does not know what any key MEANS. That is Inputs.js's job.
//
// We use `event.code`, the PHYSICAL key position ("KeyW" = where W is on a US
// keyboard). A French keyboard has Z there, but it is still the key under your
// left middle finger, which is what WASD controls are about.
// (Bruno also tracks `event.key`, the typed letter. We do not need it.)
export default class Keyboard
{
    constructor()
    {
        this.events = new Events()

        this.pressed = new Set()

        // Switching tab or window while holding a key: the "key up" would never
        // reach us, and the car would keep driving forever. So release everything.
        addEventListener('blur', () =>
        {
            for(const code of this.pressed)
                this.events.trigger('up', [ code ])

            this.pressed.clear()
        })

        addEventListener('keydown', (event) =>
        {
            // Holding a key makes the browser re-send "keydown" about 30 times a
            // second. We only care about the first one.
            if(event.repeat)
                return

            // Typing in a text field is not driving
            if(document.activeElement.matches('input, textarea, [contenteditable]') && event.code !== 'Escape')
                return

            this.pressed.add(event.code)
            this.events.trigger('down', [ event.code ])
        })

        addEventListener('keyup', (event) =>
        {
            this.pressed.delete(event.code)
            this.events.trigger('up', [ event.code ])
        })
    }
}
