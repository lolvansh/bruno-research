import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { Foliage } from './Foliage.js'

// Adapted from Bruno Simon's folio-2025 Trees.js (MIT), see LICENSE-THIRD-PARTY.
//
// ONE kind of tree (birch, oak or cherry), planted in many places.
//   visual     = the tree model: one trunk (treeBody) + several leaf clusters (treeLeaves...)
//   references = where to plant it (position + rotation of each tree)
//
// The trunk is drawn with instancing (one draw call for all trunks), the leaves
// with the Foliage shader (one draw call for all leaf clusters), and each trunk
// gets a thin cylinder collider so the car can hit it.
export class Trees
{
    constructor(visual, references, colorA, colorB)
    {
        this.game = Game.getInstance()

        this.visual = visual
        this.references = references
        this.colorA = colorA
        this.colorB = colorB

        // The reference objects come from a file that was never drawn, so their
        // matrices were never worked out. Do it now.
        for(const reference of this.references)
        {
            reference.updateMatrix()
            reference.updateMatrixWorld(true)
        }

        this.setModelParts()
        this.setBodies()
        this.setLeaves()
        this.setPhysical()
    }

    // Find the trunk and the leaf clusters in the model, by name
    setModelParts()
    {
        this.modelParts = {}
        this.modelParts.leaves = []
        this.modelParts.body = null

        this.visual.traverse((child) =>
        {
            if(child.isMesh)
            {
                if(child.name.startsWith('treeLeaves'))
                    this.modelParts.leaves.push(child)
                else if(child.name.startsWith('treeBody'))
                    this.modelParts.body = child
            }
        })

        this.modelParts.leaves.forEach((leaves) => leaves.updateMatrix())
    }

    // Trunks: one InstancedMesh, one slot per tree
    setBodies()
    {
        this.game.materials.updateObject(this.modelParts.body)

        this.bodies = new THREE.InstancedMesh(this.modelParts.body.geometry, this.modelParts.body.material, this.references.length)
        this.bodies.instanceMatrix.setUsage(THREE.StaticDrawUsage)
        this.bodies.frustumCulled = false

        this.references.forEach((reference, i) =>
        {
            this.bodies.setMatrixAt(i, reference.matrix)
        })

        this.game.scene.add(this.bodies)
    }

    // Leaves: each tree has several clusters (placed relative to the tree). Work out
    // where each cluster is in the WORLD, then hand them all to one Foliage.
    setLeaves()
    {
        const clusters = []

        for(const treeReference of this.references)
        {
            for(const leaves of this.modelParts.leaves)
            {
                const finalMatrix = leaves.matrix.clone().premultiply(treeReference.matrixWorld)

                const cluster = new THREE.Object3D()
                cluster.applyMatrix4(finalMatrix) // Splits the matrix back into position and scale

                clusters.push(cluster)
            }
        }

        this.leaves = new Foliage(clusters, this.colorA, this.colorB, true) // true: see-through around the car
    }

    // A thin cylinder in the middle of each trunk. Fixed: trees never move.
    setPhysical()
    {
        for(const reference of this.references)
        {
            this.game.objects.add(
                null,
                {
                    type: 'fixed',
                    position: reference.position.clone().add(new THREE.Vector3(0, 2.5, 0)), // Centre of the cylinder
                    rotation: reference.quaternion,
                    friction: 0.7,
                    colliders: [ { shape: 'cylinder', parameters: [ 2.5, 0.15 ] } ] // half height, radius
                }
            )
        }
    }
}
