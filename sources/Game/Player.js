import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Player.js (MIT), see LICENSE-THIRD-PARTY.
// The Player is the link between YOU and the car:
//   before physics: held keys -> three numbers the car reads
//   after physics:  tell the camera where the car is
export class Player
{
    constructor()
    {
        this.game = Game.getInstance()

        // The three numbers the car reads each frame
        this.accelerating = 0 // -1 (reverse) to 1 (forward)
        this.steering = 0 // -1 (right) to 1 (left)
        this.braking = 0 // 0 or 1
        this.boosting = 0 // 0 or 1 (Shift held)

        // How high each wheel's spring is set: 'low' (normal), 'mid' (low-rider) or 'high' (jump).
        // Order is the same as the physical wheels: front right, front left, back right, back left.
        this.suspensions = [ 'low', 'low', 'low', 'low' ]

        // Where the car appears, and drops back to when you press R
        this.spawn = { position: new THREE.Vector3(0, 3, 12), rotation: 0 }

        this.setInputs()
        this.setUnstuck()

        // Start there. The car is already created, so it can be moved.
        this.respawn()
        this.position = this.game.physicalVehicle.position.clone()

        // Priority 1: right after inputs, before physics (3). The car must know
        // what you pressed BEFORE the physics step moves it.
        this.game.ticker.events.on('tick', () =>
        {
            this.updatePrePhysics()
        }, 1)

        // Priority 6: after the car has moved (5), before the camera follows (7)
        this.game.ticker.events.on('tick', () =>
        {
            this.updatePostPhysics()
        }, 6)
    }

    respawn()
    {
        this.game.physicalVehicle.moveTo(this.spawn.position, this.spawn.rotation)
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
            { name: 'boost',    categories: [ 'wandering' ], keys: [ 'Keyboard.ShiftLeft', 'Keyboard.ShiftRight' ] },
            { name: 'brake',    categories: [ 'wandering' ], keys: [ 'Keyboard.KeyB', 'Keyboard.ControlLeft' ] },
            { name: 'respawn',  categories: [ 'wandering' ], keys: [ 'Keyboard.KeyR' ] },
            { name: 'interact', categories: [ 'wandering' ], keys: [ 'Keyboard.Enter', 'Keyboard.KeyE', 'Keyboard.KeyF' ] },

            // Suspensions. Space = all four springs "high" = the car hops.
            // The number pad (or the digit keys) raises only some wheels: 8 front, 2 back, 4 left, 6 right,
            // and the corners 7, 9, 1, 3. Those only half-raise ("mid"): the car rides low and tilts.
            { name: 'suspensions',           categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad5', 'Keyboard.Space' ] },
            { name: 'suspensionsFront',      categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad8' ] },
            { name: 'suspensionsBack',       categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad2' ] },
            { name: 'suspensionsRight',      categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad6' ] },
            { name: 'suspensionsLeft',       categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad4' ] },
            { name: 'suspensionsFrontLeft',  categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad7', 'Keyboard.Digit2' ] },
            { name: 'suspensionsFrontRight', categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad9', 'Keyboard.Digit3' ] },
            { name: 'suspensionsBackRight',  categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad3', 'Keyboard.Digit4' ] },
            { name: 'suspensionsBackLeft',   categories: [ 'wandering' ], keys: [ 'Keyboard.Numpad1', 'Keyboard.Digit1' ] },
        ])

        // R puts the car back at the start (the event fires on press AND release)
        this.game.inputs.events.on('respawn', (action) =>
        {
            if(action.active)
                this.respawn()
        })

        // Whenever any suspension key goes down or up, work out each wheel's height again
        const actions = this.game.inputs.actions
        const suspensionsUpdate = () =>
        {
            const all = actions.get('suspensions').active

            const active = [
                all || actions.get('suspensionsFront').active || actions.get('suspensionsRight').active || actions.get('suspensionsFrontRight').active, // front right
                all || actions.get('suspensionsFront').active || actions.get('suspensionsLeft').active || actions.get('suspensionsFrontLeft').active,   // front left
                all || actions.get('suspensionsBack').active || actions.get('suspensionsRight').active || actions.get('suspensionsBackRight').active,   // back right
                all || actions.get('suspensionsBack').active || actions.get('suspensionsLeft').active || actions.get('suspensionsBackLeft').active,     // back left
            ]

            const state = all ? 'high' : 'mid'

            for(let i = 0; i < 4; i++)
                this.suspensions[i] = active[i] ? state : 'low'
        }

        for(const name of [
            'suspensions', 'suspensionsFront', 'suspensionsBack', 'suspensionsRight', 'suspensionsLeft',
            'suspensionsFrontLeft', 'suspensionsFrontRight', 'suspensionsBackRight', 'suspensionsBackLeft'
        ])
        {
            this.game.inputs.events.on(name, suspensionsUpdate)
        }
    }

    // FLIP-OVER RECOVERY. If the car lies upside down, wait a few seconds (maybe you are just
    // in a long flip), and if it is still upside down, give it a hop that turns it back over.
    // Tried again every few seconds until it works. R still teleports you to the start.
    setUnstuck()
    {
        this.unstuck = {}
        this.unstuck.duration = 3 // Seconds upside down before the car helps itself
        this.unstuck.since = null // When it last became upside down (real seconds), or null
    }

    updateUnstuck()
    {
        const vehicle = this.game.physicalVehicle

        if(!vehicle.upsideDown.active)
        {
            this.unstuck.since = null
            return
        }

        const elapsed = this.game.ticker.elapsed

        if(this.unstuck.since === null)
            this.unstuck.since = elapsed

        if(elapsed - this.unstuck.since > this.unstuck.duration)
        {
            vehicle.flip.jump()
            this.unstuck.since = elapsed // Wait again, in case it did not land right side up
        }
    }

    updatePrePhysics()
    {
        const actions = this.game.inputs.actions

        this.accelerating = 0
        this.steering = 0
        this.braking = 0
        this.boosting = 0

        // Forward and backward together cancel out
        if(actions.get('forward').active)
            this.accelerating += actions.get('forward').value

        if(actions.get('backward').active)
            this.accelerating -= actions.get('backward').value

        // Shift: more engine force and a much higher top speed
        if(actions.get('boost').active)
            this.boosting = 1

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

    updatePostPhysics()
    {
        // Where the car is, for anyone who asks (HUD, later: the world, achievements...)
        this.position.copy(this.game.physicalVehicle.position)

        // The camera follows the car
        this.game.view.focusPoint.trackedPosition.copy(this.position)

        this.updateUnstuck()
    }
}
