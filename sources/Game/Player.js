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

        // Where the car appears, and drops back to when you press R
        this.spawn = { position: new THREE.Vector3(0, 3, 12), rotation: 0 }

        this.setInputs()

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
            { name: 'brake',    categories: [ 'wandering' ], keys: [ 'Keyboard.KeyB', 'Keyboard.ControlLeft' ] },
            { name: 'respawn',  categories: [ 'wandering' ], keys: [ 'Keyboard.KeyR' ] },
            { name: 'interact', categories: [ 'wandering' ], keys: [ 'Keyboard.Enter', 'Keyboard.KeyE', 'Keyboard.KeyF' ] },
        ])

        // R puts the car back at the start (the event fires on press AND release)
        this.game.inputs.events.on('respawn', (action) =>
        {
            if(action.active)
                this.respawn()
        })
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

    updatePostPhysics()
    {
        // Where the car is, for anyone who asks (HUD, later: the world, achievements...)
        this.position.copy(this.game.physicalVehicle.position)

        // The camera follows the car
        this.game.view.focusPoint.trackedPosition.copy(this.position)
    }
}
