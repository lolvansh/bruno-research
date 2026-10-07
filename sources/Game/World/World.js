import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()

        this.setTestCube()
    }

    // A spinning cube, only to prove the loop works. It will be deleted.
    setTestCube()
    {
        this.cube = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshNormalMaterial() // Colours by face direction, needs no light
        )
        this.game.scene.add(this.cube)

        // Priority 10: after physics and input (later steps), before drawing (998)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    update()
    {
        // Multiply by delta so the speed is the same on 60 Hz and 144 Hz screens
        this.cube.rotation.y += this.game.ticker.delta * 1
        this.cube.rotation.x += this.game.ticker.delta * 0.5
    }
}
