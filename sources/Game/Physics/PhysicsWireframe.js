import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

// Adapted from Bruno Simon's folio-2025 PhysicsWireframe.js (MIT), see LICENSE-THIRD-PARTY.
//
// Draws the INVISIBLE colliders as lines. Essential for debugging: what you see
// and what the physics sees can be different, and this shows the second one.
// Press P to toggle it, or open the page with #physics at the end of the address.
export class PhysicsWireframe
{
    constructor()
    {
        this.game = Game.getInstance()

        this.active = false

        // The GPU buffer is created ONCE, at the size of the first data it sees, and
        // cannot grow by itself. So we reserve room up front (`capacity` vertices),
        // write into it, and tell the GPU how many to actually draw (setDrawRange).
        // Bruno's version replaces the arrays every frame instead, which breaks
        // in WebGPU as soon as the number of lines grows (our boxes keep arriving).
        this.geometry = new THREE.BufferGeometry()
        this.capacity = 0
        this.ensureCapacity(4096)

        this.material = new THREE.LineBasicNodeMaterial({ vertexColors: true })
        this.lineSegments = new THREE.LineSegments(this.geometry, this.material)
        this.lineSegments.frustumCulled = false // Its bounds change every frame

        if(location.hash.match(/physics/i))
            this.setActive(true)

        this.game.inputs.addActions([
            { name: 'wireframe', categories: [], keys: [ 'Keyboard.KeyP' ] }
        ])

        this.game.inputs.events.on('wireframe', (action) =>
        {
            // The event fires on press AND release; only react to the press
            if(action.active)
                this.setActive(!this.active)
        })

        // Priority 4: right after the physics step (3), so the lines match the new positions
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 4)
    }

    // Make sure there is room for `count` vertices. If not, start over with double.
    ensureCapacity(count)
    {
        if(count <= this.capacity)
            return

        // Frees the old (too small) GPU buffers
        this.geometry.dispose()

        this.capacity = Math.max(count * 2, 4096)
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.capacity * 3), 3))
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.capacity * 4), 4))
    }

    setActive(active)
    {
        this.active = active

        if(this.active)
            this.game.scene.add(this.lineSegments)
        else
            this.game.scene.remove(this.lineSegments)
    }

    update()
    {
        if(!this.active)
            return

        // Rapier hands us ready-made line vertices and colours for every collider
        const { vertices, colors } = this.game.physics.world.debugRender()

        const count = vertices.length / 3

        this.ensureCapacity(count)

        // Copy into the existing buffers, then draw only the first `count` vertices
        this.geometry.attributes.position.array.set(vertices)
        this.geometry.attributes.position.needsUpdate = true

        this.geometry.attributes.color.array.set(colors)
        this.geometry.attributes.color.needsUpdate = true

        this.geometry.setDrawRange(0, count)
    }
}
