import { Events } from '../Events.js'
import { Game } from '../Game.js'
import Keyboard from './Keyboard.js'
import { Wheel } from './Wheel.js'

// Adapted from Bruno Simon's folio-2025 Inputs.js (MIT), see LICENSE-THIRD-PARTY.
// Much smaller: no gamepad, touch joystick, pointer or input modes. Those can
// plug into start() / end() exactly like the keyboard does, which is the point.
//
// THE IDEA: the game never asks "is W pressed?". It asks "is `forward` active?".
// An ACTION is a name plus the list of keys that trigger it:
//
//     { name: 'forward', keys: [ 'Keyboard.KeyW', 'Keyboard.ArrowUp' ] }
//
// Change the keys here and nothing else in the game changes. Add a gamepad
// later by adding 'Gamepad.up' to the list.
export class Inputs
{
    constructor()
    {
        this.game = Game.getInstance()

        this.events = new Events()
        this.actions = new Map()

        this.setKeyboard()
        this.setWheel()
    }

    setKeyboard()
    {
        this.keyboard = new Keyboard()

        this.keyboard.events.on('down', (code) =>
        {
            this.start(`Keyboard.${code}`)
        })

        this.keyboard.events.on('up', (code) =>
        {
            this.end(`Keyboard.${code}`)
        })
    }

    setWheel()
    {
        this.wheel = new Wheel()

        this.wheel.events.on('roll', (value) =>
        {
            // The wheel has no "release": every roll is its own one-off event
            this.start('Wheel.roll', value, false)
        })
    }

    // Anyone can register actions. Bruno does it where the action is used
    // (Player registers the driving actions, View registers zoom).
    addActions(actions)
    {
        for(const action of actions)
        {
            const formatedAction = { ...action }
            formatedAction.active = false // Is it held right now?
            formatedAction.value = 0 // 1 for a key, a number for a wheel
            formatedAction.trigger = null // 'start' or 'end', the last thing that happened
            formatedAction.activeKeys = new Set() // Which keys hold it (two keys can hold one action)

            this.actions.set(action.name, formatedAction)
        }
    }

    // A key went down. Find every action that lists it.
    // isToggle = false for things that have no "release", like the wheel.
    start(key, value = 1, isToggle = true)
    {
        const matchingActions = [ ...this.actions.values() ].filter((_action) => _action.keys.indexOf(key) !== - 1)

        for(const action of matchingActions)
        {
            action.value = value
            action.activeKeys.add(key)
            action.trigger = 'start'

            // On/off actions: only announce when it changes from off to on
            if(isToggle)
            {
                if(!action.active)
                {
                    action.active = true

                    this.events.trigger('actionStart', [ action ])
                    this.events.trigger(action.name, [ action ])
                }
            }

            // One-off actions: announce every time
            else
            {
                this.events.trigger('actionStart', [ action ])
                this.events.trigger(action.name, [ action ])
            }
        }
    }

    // A key went up. The action only turns off when NO key is holding it:
    // holding W and ArrowUp, then releasing W, still drives forward.
    end(key, value = 0)
    {
        const matchingActions = [ ...this.actions.values() ].filter((_action) => _action.keys.indexOf(key) !== - 1)

        for(const action of matchingActions)
        {
            if(action.active)
            {
                action.activeKeys.delete(key)

                if(action.activeKeys.size === 0)
                {
                    action.active = false
                    action.value = value
                    action.trigger = 'end'

                    this.events.trigger('actionEnd', [ action ])
                    this.events.trigger(action.name, [ action ])
                }
            }
        }
    }
}
