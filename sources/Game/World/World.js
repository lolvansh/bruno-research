import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()

        this.setGround()
        this.setTestBlocks()
        this.setBenches()
        this.setTestVehicleVisual()
        this.setBoxDropper()

        // Priority 10: the dropper timer. (Nothing here must run before physics.)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    // The first REAL model: Bruno's bench, loaded from a GLB file.
    // The file holds 7 benches at the positions they have in his world.
    // We take the first one and reuse it three times.
    // (Visual only for now. Making models physical from Blender names is step 8.)
    setBenches()
    {
        const model = this.game.resources.benchesModel.scene
        const original = model.children.find((child) => child.name.startsWith('benchPhysical'))

        // Swap its material for the shared palette material
        this.game.materials.updateObject(original)

        const placements = [
            { position: [ -4, 0.76, 6 ], rotation: 0 },
            { position: [ 4, 0.76, 6 ], rotation: Math.PI * 0.5 },
            { position: [ -14, 0.76, 6 ], rotation: Math.PI * 0.25 },
        ]

        this.benches = []

        for(const placement of placements)
        {
            const bench = original.clone() // Same shape, same material, new object
            bench.position.set(...placement.position)
            bench.rotation.y = placement.rotation
            this.game.scene.add(bench)
            this.benches.push(bench)
        }
    }

    // A box painted with one palette swatch.
    // type: 'fixed' (solid, never moves), 'dynamic' (falls and gets pushed), or null (no physics)
    addBlock(size, position, paletteIndex, type = null, rotation = null)
    {
        const geometry = this.game.materials.paint(new THREE.BoxGeometry(...size), paletteIndex)
        const mesh = new THREE.Mesh(geometry, this.game.materials.palette)
        mesh.position.set(...position)

        if(type === null)
        {
            this.game.scene.add(mesh)
            return mesh
        }

        // The physics shape must match the visible one. Rapier takes HALF the size
        // on each axis (distance from the centre to a face).
        this.game.objects.add(
            { model: mesh },
            {
                type: type,
                position: { x: position[0], y: position[1], z: position[2] },
                rotation: rotation ?? undefined,
                colliders: [ { shape: 'cuboid', parameters: [ size[0] * 0.5, size[1] * 0.5, size[2] * 0.5 ] } ]
            }
        )

        return mesh
    }

    // The visible ground (a painted plane) AND the invisible physical ground.
    // They are separate things that happen to sit in the same place.
    setGround()
    {
        // Visual: swatch 9 (soft green)
        const geometry = this.game.materials.paint(new THREE.PlaneGeometry(200, 200), 9)
        geometry.rotateX(- Math.PI * 0.5) // Planes stand up by default, lay it flat

        this.ground = new THREE.Mesh(geometry, this.game.materials.palette)
        this.game.scene.add(this.ground)

        // Physical: a thick slab whose TOP face is at y = 0. No mesh, so `visual` is null.
        this.game.objects.add(
            null,
            {
                type: 'fixed',
                position: { x: 0, y: - 1, z: 0 },
                colliders: [ { shape: 'cuboid', parameters: [ 100, 1, 100 ] } ]
            }
        )
    }

    // TEMPORARY: a few coloured blocks, solid, so you have things to drive around and bump into
    setTestBlocks()
    {
        this.addBlock([ 4, 2, 4 ], [ -12, 1, -6 ], 1, 'fixed') // cream
        this.addBlock([ 3, 3, 3 ], [ 14, 1.5, 8 ], 14, 'fixed') // terracotta
        this.addBlock([ 6, 1.5, 2 ], [ -6, 0.75, 14 ], 3, 'fixed') // sky blue
        this.addBlock([ 2, 2, 2 ], [ 8, 1, -14 ], 8, 'fixed') // yellow
        this.addBlock([ 1, 4, 1 ], [ 0, 2, 0 ], 19, 'fixed') // crimson pillar in the middle
    }

    // TEMPORARY (replaced by the real car model in 7c): a red box for the chassis
    // and four dark cylinders for the wheels. Every frame it copies what the
    // physical car is doing, so you can SEE the springs and the steering.
    setTestVehicleVisual()
    {
        const materials = this.game.materials
        const vehicle = this.game.physicalVehicle

        this.vehicleVisual = new THREE.Group()

        // Same sizes and offsets as the physical colliders (full size = 2 x half size)
        const body = new THREE.Mesh(materials.paint(new THREE.BoxGeometry(2.6, 0.8, 1.7), 16), materials.palette)
        body.position.y = - 0.1
        const cabin = new THREE.Mesh(materials.paint(new THREE.BoxGeometry(1.0, 0.3, 1.3), 17), materials.palette)
        cabin.position.y = 0.4
        this.vehicleVisual.add(body, cabin)

        // Wheels: cylinders lying on their side (axle along Z)
        this.vehicleWheels = []
        for(const wheel of vehicle.wheels.items)
        {
            const geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.5, 16)
            geometry.rotateX(Math.PI * 0.5)
            materials.paint(geometry, 22)

            const mesh = new THREE.Mesh(geometry, materials.palette)
            this.vehicleVisual.add(mesh)
            this.vehicleWheels.push(mesh)
        }

        this.game.scene.add(this.vehicleVisual)

        // Priority 8: after the car has moved (5)
        this.game.ticker.events.on('tick', () =>
        {
            this.vehicleVisual.position.copy(vehicle.position)
            this.vehicleVisual.quaternion.copy(vehicle.quaternion)

            for(let i = 0; i < 4; i++)
            {
                const wheel = vehicle.wheels.items[i]

                // The wheel hangs `suspensionLength` below its attachment point
                this.vehicleWheels[i].position.set(wheel.basePosition.x, wheel.basePosition.y - wheel.suspensionLength, wheel.basePosition.z)

                // Front wheels (0 and 1) turn with the steering
                this.vehicleWheels[i].rotation.y = i < 2 ? vehicle.steer : 0
            }
        }, 8)
    }

    // TEMPORARY: rain boxes on the world so you can watch the physics work
    // and push them around with the car.
    setBoxDropper()
    {
        this.dropped = 0
        this.maxDropped = 20
        this.dropTimer = 0
        this.dropPalette = [ 1, 3, 8, 14, 18, 20, 21 ] // swatches to pick from
    }

    dropBox()
    {
        const size = 0.8 + Math.random() * 0.6

        // A random starting tilt, so they land messily
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3))

        this.addBlock(
            [ size, size, size ],
            [ (Math.random() - 0.5) * 16, 8 + Math.random() * 4, (Math.random() - 0.5) * 16 ],
            this.dropPalette[Math.floor(Math.random() * this.dropPalette.length)],
            'dynamic',
            rotation
        )

        this.dropped++
    }

    update()
    {
        // One new box every half second, up to the limit
        this.dropTimer += this.game.ticker.delta
        if(this.dropTimer > 0.5 && this.dropped < this.maxDropped)
        {
            this.dropTimer = 0
            this.dropBox()
        }
    }
}
