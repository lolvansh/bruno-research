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
        this.setTestCar()
    }

    // The first REAL model: Bruno's bench, loaded from a GLB file.
    // The file holds 7 benches at the positions they have in his world.
    // We take the first one and reuse it three times.
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

    // A box painted with one palette swatch
    addBlock(size, position, paletteIndex)
    {
        const geometry = this.game.materials.paint(new THREE.BoxGeometry(...size), paletteIndex)
        const mesh = new THREE.Mesh(geometry, this.game.materials.palette)
        mesh.position.set(...position)
        this.game.scene.add(mesh)

        return mesh
    }

    // A big flat plane painted with swatch 9 (soft green)
    setGround()
    {
        const geometry = this.game.materials.paint(new THREE.PlaneGeometry(200, 200), 9)
        geometry.rotateX(- Math.PI * 0.5) // Planes stand up by default, lay it flat

        this.ground = new THREE.Mesh(geometry, this.game.materials.palette)
        this.game.scene.add(this.ground)
    }

    // TEMPORARY: a few coloured blocks so the world has landmarks
    // and you can see the camera moving past things.
    setTestBlocks()
    {
        this.addBlock([ 4, 2, 4 ], [ -12, 1, -6 ], 1) // cream
        this.addBlock([ 3, 3, 3 ], [ 14, 1.5, 8 ], 14) // terracotta
        this.addBlock([ 6, 1.5, 2 ], [ -6, 0.75, 14 ], 3) // sky blue
        this.addBlock([ 2, 2, 2 ], [ 8, 1, -14 ], 8) // yellow
        this.addBlock([ 1, 4, 1 ], [ 0, 2, 0 ], 19) // crimson pillar in the middle
    }

    // TEMPORARY: a box the size of Bruno's car body, driving in a circle.
    // It stands in for the player until step 7.
    setTestCar()
    {
        this.testCar = this.addBlock([ 2.6, 0.8, 1.7 ], [ 0, 0.4, 0 ], 16) // red

        this.angle = 0

        // Priority 6: the player moves BEFORE the camera (priority 7).
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 6)
    }

    update()
    {
        // Drive in a circle of radius 10
        this.angle += this.game.ticker.delta * 0.4
        this.testCar.position.x = Math.cos(this.angle) * 10
        this.testCar.position.z = Math.sin(this.angle) * 10

        // Face along the direction of travel (the car's long side is its X axis)
        this.testCar.rotation.y = - (this.angle + Math.PI * 0.5)

        // Tell the camera what to follow
        this.game.view.focusPoint.trackedPosition.copy(this.testCar.position)
    }
}
