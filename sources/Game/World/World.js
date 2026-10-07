import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()

        this.setTestGrid()
        this.setTestCar()
    }

    // TEMPORARY: a grid so you can SEE the camera moving over something
    setTestGrid()
    {
        const grid = new THREE.GridHelper(80, 80, '#ffffff', '#4a5f80')
        this.game.scene.add(grid)
    }

    // TEMPORARY: a box the size of Bruno's car body, driving in a circle.
    // It stands in for the player until step 7.
    setTestCar()
    {
        this.testCar = new THREE.Mesh(
            new THREE.BoxGeometry(2.6, 0.8, 1.7),
            new THREE.MeshNormalMaterial()
        )
        this.testCar.position.y = 0.4
        this.game.scene.add(this.testCar)

        this.angle = 0

        // Priority 6: the player moves BEFORE the camera (priority 7).
        // Swap these numbers and the camera would lag one frame behind.
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
