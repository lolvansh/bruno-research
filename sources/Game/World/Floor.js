import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

// Inspired by Bruno Simon's folio-2025 Floor.js (MIT), see LICENSE-THIRD-PARTY.
// His floor follows the camera and sinks in a vertex shader. Ours is one fixed mesh
// whose shape is worked out on the CPU, from the SAME function the physics uses.
// So what you see and what the car drives on cannot disagree.
//
// Three things are built here:
//   1. the floor you see   (a grid of squares, sunk where the map says water)
//   2. the floor you touch (a Rapier "heightfield": the same grid, as physics)
//   3. invisible walls at the edge of the map, so the car cannot leave it
export class Floor
{
    constructor()
    {
        this.game = Game.getInstance()

        this.terrain = this.game.terrain

        this.setVisual()
        this.setSea()
        this.setPhysical()
        this.setWalls()
    }

    setVisual()
    {
        const terrain = this.terrain

        // A flat grid of 128 x 128 squares, lying down...
        const geometry = new THREE.PlaneGeometry(terrain.size, terrain.size, terrain.segments, terrain.segments)
        geometry.rotateX(- Math.PI * 0.5)

        // ...then every point is moved up or down to the map's height there
        const position = geometry.attributes.position

        for(let i = 0; i < position.count; i++)
            position.setY(i, terrain.heightAt(position.getX(i), position.getZ(i)))

        // Normals say which way each point faces. Needed so slopes are lit correctly.
        geometry.computeVertexNormals()

        // One material for the floor AND the sea: its colour is decided by the map
        this.material = new THREE.MeshLambertNodeMaterial()
        this.material.colorNode = terrain.floorColorNode()

        this.mesh = new THREE.Mesh(geometry, this.material)
        this.mesh.receiveShadow = true // The ground catches the shadows of everything on it
        this.game.scene.add(this.mesh)
    }

    // The map ends at +/-96, but the camera can see further than that. Past the edge the map
    // repeats its last pixel (deep sea), so one huge flat plane with the SAME material
    // continues the sea seamlessly all the way to the horizon.
    setSea()
    {
        const geometry = new THREE.PlaneGeometry(1500, 1500)
        geometry.rotateX(- Math.PI * 0.5)

        this.sea = new THREE.Mesh(geometry, this.material)
        this.sea.position.y = - this.terrain.depthScale - 0.03 // Just under the deepest floor, so they never flicker
        this.game.scene.add(this.sea)
    }

    // The physics version of the floor: the same grid of heights
    setPhysical()
    {
        const terrain = this.terrain

        this.physical = this.game.objects.add(
            null,
            {
                type: 'fixed',
                friction: 0.2,
                restitution: 0.15,
                colliders: [
                    {
                        shape: 'heightfield',
                        // rows, columns, the heights, and the total size in x, y (a multiplier) and z
                        parameters: [ terrain.segments, terrain.segments, terrain.heights, { x: terrain.size, y: 1, z: terrain.size } ]
                    }
                ]
            }
        )
    }

    // Four tall invisible walls just inside the map's edge
    setWalls()
    {
        const reach = this.terrain.size / 2 - 8 // 88: the walls' inner face
        const thickness = 2
        const halfLength = this.terrain.size / 2
        const halfHeight = 6

        const walls = [
            { position: { x: reach + thickness, y: 0, z: 0 }, size: [ thickness, halfHeight, halfLength ] },
            { position: { x: - reach - thickness, y: 0, z: 0 }, size: [ thickness, halfHeight, halfLength ] },
            { position: { x: 0, y: 0, z: reach + thickness }, size: [ halfLength, halfHeight, thickness ] },
            { position: { x: 0, y: 0, z: - reach - thickness }, size: [ halfLength, halfHeight, thickness ] },
        ]

        for(const wall of walls)
        {
            this.game.objects.add(
                null,
                {
                    type: 'fixed',
                    position: wall.position,
                    colliders: [ { shape: 'cuboid', parameters: wall.size } ]
                }
            )
        }
    }
}
