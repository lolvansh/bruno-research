import { Game } from '../Game.js'

// Adapted from Bruno Simon's folio-2025 Physics.js (MIT), see LICENSE-THIRD-PARTY.
// Smaller: no collision groups, no water, no sounds, no kinematic bodies.
//
// Rapier simulates an invisible world of "bodies" (things that move) with
// "colliders" (their invisible shapes). It knows nothing about meshes or
// colours. Each frame we call world.step() and it moves the bodies.
export class Physics
{
    constructor()
    {
        this.game = Game.getInstance()

        // Gravity pulls down at 9.81 units per second, per second
        this.world = new this.game.RAPIER.World({ x: 0, y: - 9.81, z: 0 })

        // Priority 3: after input and the player (1), before objects copy results (4)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 3)
    }

    // Turns a plain description into a real Rapier body with colliders:
    //
    // {
    //     type: 'dynamic' | 'fixed',   // dynamic = moves and falls, fixed = never moves
    //     position: { x, y, z },
    //     rotation: quaternion,         // optional
    //     mass,                         // optional: total mass, shared between the colliders
    //     friction, restitution,        // optional (restitution = bounciness)
    //     sleeping: true,               // optional: starts at rest, wakes up when touched
    //     colliders: [
    //         { shape: 'cuboid',   parameters: [ halfX, halfY, halfZ ] },
    //         { shape: 'ball',     parameters: [ radius ] },
    //         { shape: 'cylinder', parameters: [ halfHeight, radius ] },
    //         { shape: 'hull',     parameters: [ vertices ] },            // wraps the points in a convex shape
    //         { shape: 'trimesh',  parameters: [ vertices, indices ] },   // the exact triangles
    //         { shape: 'heightfield', parameters: [ rows, columns, heights, { x, y, z } ] },  // a grid of heights: terrain
    //         // every collider can also have: position: { x, y, z }, quaternion
    //     ]
    // }
    getPhysical(_physicalDescription)
    {
        const physical = {}

        // Body
        let rigidBodyDesc = this.game.RAPIER.RigidBodyDesc

        if(_physicalDescription.type === 'fixed')
        {
            physical.type = 'fixed'
            rigidBodyDesc = rigidBodyDesc.fixed()
        }
        else
        {
            physical.type = 'dynamic'
            rigidBodyDesc = rigidBodyDesc.dynamic()
        }

        if(typeof _physicalDescription.position !== 'undefined')
            rigidBodyDesc.setTranslation(_physicalDescription.position.x, _physicalDescription.position.y, _physicalDescription.position.z)

        if(typeof _physicalDescription.rotation !== 'undefined')
            rigidBodyDesc.setRotation(_physicalDescription.rotation)

        // A little air drag so things do not slide or spin forever
        rigidBodyDesc.setLinearDamping(_physicalDescription.linearDamping ?? 0.1)
        rigidBodyDesc.setAngularDamping(_physicalDescription.angularDamping ?? 0.1)

        // A body that can sleep stops being simulated when it rests. The car must never sleep.
        if(typeof _physicalDescription.canSleep !== 'undefined')
            rigidBodyDesc.setCanSleep(_physicalDescription.canSleep)

        // Starts asleep: costs nothing until something touches it
        if(typeof _physicalDescription.sleeping !== 'undefined')
            rigidBodyDesc.setSleeping(_physicalDescription.sleeping)

        physical.body = this.world.createRigidBody(rigidBodyDesc)

        // Colliders
        physical.colliders = []

        for(const _colliderDescription of _physicalDescription.colliders)
        {
            let colliderDescription = this.game.RAPIER.ColliderDesc

            if(_colliderDescription.shape === 'cuboid')
                colliderDescription = colliderDescription.cuboid(..._colliderDescription.parameters)
            else if(_colliderDescription.shape === 'ball')
                colliderDescription = colliderDescription.ball(..._colliderDescription.parameters)
            else if(_colliderDescription.shape === 'cylinder')
                colliderDescription = colliderDescription.cylinder(..._colliderDescription.parameters)
            else if(_colliderDescription.shape === 'hull')
                colliderDescription = colliderDescription.convexHull(_colliderDescription.parameters[0])
            else if(_colliderDescription.shape === 'trimesh')
                colliderDescription = colliderDescription.trimesh(_colliderDescription.parameters[0], _colliderDescription.parameters[1])
            else if(_colliderDescription.shape === 'heightfield')
                colliderDescription = colliderDescription.heightfield(..._colliderDescription.parameters)

            // convexHull() gives back null when the points cannot form a solid shape
            if(!colliderDescription)
            {
                console.warn(`Physics: could not build a "${_colliderDescription.shape}" collider, skipped`)
                continue
            }

            // Offset and tilt of this collider relative to the body
            if(_colliderDescription.position)
                colliderDescription = colliderDescription.setTranslation(_colliderDescription.position.x, _colliderDescription.position.y, _colliderDescription.position.z)

            if(_colliderDescription.quaternion)
                colliderDescription = colliderDescription.setRotation(_colliderDescription.quaternion)

            // Density 0.1 is Bruno's value: light things, so a car of mass 2.5 can push boxes around
            colliderDescription = colliderDescription.setDensity(0.1)

            // Optional: fix the mass instead of letting the shape decide.
            // centerOfMass: where the weight sits. A LOW one makes the car hard to tip over.
            if(typeof _colliderDescription.mass !== 'undefined')
            {
                if(typeof _colliderDescription.centerOfMass !== 'undefined')
                    colliderDescription = colliderDescription.setMassProperties(_colliderDescription.mass, _colliderDescription.centerOfMass, { x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0, w: 1 })
                else
                    colliderDescription = colliderDescription.setMass(_colliderDescription.mass)
            }

            // Or a total mass for the whole body, shared equally between its colliders
            if(typeof _physicalDescription.mass !== 'undefined')
                colliderDescription = colliderDescription.setMass(_physicalDescription.mass / _physicalDescription.colliders.length)

            colliderDescription = colliderDescription.setFriction(_physicalDescription.friction ?? _colliderDescription.friction ?? 0.2)
            colliderDescription = colliderDescription.setRestitution(_physicalDescription.restitution ?? _colliderDescription.restitution ?? 0.15)

            physical.colliders.push(this.world.createCollider(colliderDescription, physical.body))
        }

        return physical
    }

    update()
    {
        // Advance the simulation by the time since the last frame, on the GAME clock (2x)
        this.world.timestep = this.game.ticker.deltaScaled
        this.world.step()
    }
}
