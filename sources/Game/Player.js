import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Player.js (MIT), see LICENSE-THIRD-PARTY.
// For now only the INPUT half: it turns held keys into three numbers.
// The vehicle (7b, 7c) will read those numbers. The Player does not move anything.
export class Player
{
    constructor()
    {
        this.game = Game.getInstance()

        // The three numbers the car will read each frame
        this.accelerating = 0 // -1 (reverse) to 1 (forward)
        this.steering = 0 // -1 (right) to 1 (left)
        this.braking = 0 // 0 or 1

        this.setInputs()

        // Priority 1: right after inputs, before physics (3). The car must know
        // what you pressed BEFORE the physics step moves it.
        this.game.ticker.events.on('tick', () =>
        {
            this.updatePrePhysics()
        }, 1)
    }

    setInputs()
    {
        // `categories` is a label Bruno uses to switch groups of actions on and
        // off (for example while a menu is open). We store it but do not use it yet.
        this.game.inputs.addActions([
            { name: 'forward',  categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowUp', 'Keyboard.KeyW' ] },
            { name: 'right',    categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowRight', 'Keyboard.KeyD' ] },
            { name: 'backward', categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowDown', 'Keyboard.KeyS' ] },
            { name: 'left',     categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowLeft', 'Keyboard.KeyA' ] },
            { name: 'brake',    categories: [ 'wandering' ], keys: [ 'Keyboard.KeyB', 'Keyboard.ControlLeft' ] },
            { name: 'respawn',  categories: [ 'wandering' ], keys: [ 'Keyboard.KeyR' ] },
            { name: 'interact', categories: [ 'wandering' ], keys: [ 'Keyboard.Enter', 'Keyboard.KeyE', 'Keyboard.KeyF' ] },
        ])
    }

    updatePrePhysics()
    {
        const actions = this.game.inputs.actions

        this.accelerating = 0
        this.steering = 0
        this.braking = 0

        // Forward and backward together cancel out
        if(actions.get('forward').active)
            this.accelerating += actions.get('forward').value

        if(actions.get('backward').active)
            this.accelerating -= actions.get('backward').value

        // Brake overrides the engine
        if(actions.get('brake').active)
        {
            this.accelerating = 0
            this.braking = 1
        }

        // Steering: left is positive, right is negative (the car faces +X, so
        // turning left means rotating toward -Z, which is the positive direction
        // of rotation around Y). Same signs as Bruno's.
        if(actions.get('right').active)
            this.steering -= 1

        if(actions.get('left').active)
            this.steering += 1
    }
}
