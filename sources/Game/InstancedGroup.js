import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 InstancedGroup.js (MIT), see LICENSE-THIRD-PARTY.
//
// INSTANCING: drawing 7 benches normally costs 7 draw calls: the CPU tells the
// GPU "draw this mesh here", seven times. With instancing the CPU says ONCE
// "draw this mesh at these 7 places". Same picture, far less work. It is what
// makes hundreds of trees, fences or bricks cheap.
//
// How it fits together:
//   references = a list of plain Object3Ds. They are NOT drawn. Each one only
//                holds a position, rotation and scale, and the physics moves it.
//   group      = the model to draw (one copy). Every mesh inside it becomes
//                one InstancedMesh with one slot per reference.
// When a reference moves, set `reference.needsUpdate = true` and the matching
// slot is rewritten on the next tick.
export class InstancedGroup
{
    constructor(references = [], group = null, autoUpdate = true)
    {
        this.game = Game.getInstance()

        this.references = references
        this.group = group
        this.count = this.references.length
        this.needsUpdate = false // true = rewrite every slot

        this.setMeshes()

        if(autoUpdate)
        {
            // Priority 13: after the physics step (3) and the mesh copy (4)
            this.game.ticker.events.on('tick', () =>
            {
                this.update()
            }, 13)
        }

        this.update()
    }

    setMeshes()
    {
        this.meshes = []

        this.group.traverse((_child) =>
        {
            if(_child.isMesh)
            {
                const mesh = {}

                // Where this mesh sits INSIDE the model (a model can have several parts)
                _child.updateMatrix()
                mesh.localMatrix = _child.matrix.clone()

                mesh.instance = new THREE.InstancedMesh(_child.geometry, _child.material, this.count)
                mesh.instance.name = _child.name
                mesh.instance.castShadow = _child.castShadow
                mesh.instance.receiveShadow = _child.receiveShadow
                mesh.instance.frustumCulled = false // The bounds of the whole set are not computed
                this.game.scene.add(mesh.instance)

                this.meshes.push(mesh)
            }
        })
    }

    // Plain Object3Ds copying the position, rotation and scale of each child
    static getReferencesFromChildren(children)
    {
        const references = []

        for(const child of children)
        {
            const reference = new THREE.Object3D()
            reference.position.copy(child.position)
            reference.rotation.copy(child.rotation)
            reference.scale.copy(child.scale)
            reference.needsUpdate = true
            references.push(reference)
        }

        return references
    }

    // From a list of identical models: one clean "base" (at the origin) and one reference each
    static getBaseAndReferencesFromInstances(instances)
    {
        const base = instances[0].clone()

        base.position.set(0, 0, 0)
        base.rotation.set(0, 0, 0)

        const references = InstancedGroup.getReferencesFromChildren(instances)

        return [ base, references ]
    }

    update()
    {
        let updated = 0
        let i = 0

        for(const _reference of this.references)
        {
            if(this.needsUpdate || _reference.needsUpdate)
            {
                updated++
                _reference.needsUpdate = false
                _reference.updateMatrixWorld()

                // slot i = (the part's place inside the model) x (the reference's place in the world)
                for(const instancedMesh of this.meshes)
                {
                    const finalMatrix = instancedMesh.localMatrix.clone().premultiply(_reference.matrixWorld)
                    instancedMesh.instance.setMatrixAt(i, finalMatrix)
                }
            }

            i++
        }

        // Tell the GPU the slots changed
        if(updated)
        {
            for(const instancedMesh of this.meshes)
                instancedMesh.instance.instanceMatrix.needsUpdate = true
        }

        this.needsUpdate = false
    }
}
