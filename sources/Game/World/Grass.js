import * as THREE from 'three/webgpu'
import { step, mod, uniformArray, varying, vertexIndex, rotateUV, cameraPosition, atan, vec3, vec2, Fn, attribute, uniform, mix, sin, time, transformNormalToView } from 'three/tsl'
import { Game } from '../Game.js'

// Adapted from Bruno Simon's folio-2025 Grass.js (MIT), see LICENSE-THIRD-PARTY.
// Left out for now: the noise texture for height variation (a sine instead),
// the wheel tracks, the see-through fade.
//
// Every blade of grass is ONE TRIANGLE. The geometry only stores where each blade
// stands (a 2D point, repeated for its 3 corners). The SHADER then builds the blade:
//   corner 0 = the tip (up, 1 high), corner 1 = bottom left, corner 2 = bottom right.
//   it sets the height, turns the blade to face the camera, and sways its tip.
//
// ~40,000 blades cover only a square window around the camera. When you move,
// blades leaving one side wrap around to the other side (the `mod` below), so the
// cost stays the same however far you drive.
export class Grass
{
    constructor()
    {
        this.game = Game.getInstance()

        this.subdivisions = 200 // The window is 200 x 200 cells, one blade per cell
        this.size = 60 // The window is 60 x 60 world units
        this.count = this.subdivisions * this.subdivisions
        this.fragmentSize = this.size / this.subdivisions

        this.setGeometry()
        this.setMaterial()
        this.setMesh()

        // Priority 10: after the camera focus moved (7)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setGeometry()
    {
        const position = new Float32Array(this.count * 3 * 2) // 3 corners x (x, z)
        const heightRandomness = new Float32Array(this.count * 3)

        for(let iX = 0; iX < this.subdivisions; iX++)
        {
            const fragmentX = (iX / this.subdivisions - 0.5) * this.size + this.fragmentSize * 0.5

            for(let iZ = 0; iZ < this.subdivisions; iZ++)
            {
                const fragmentZ = (iZ / this.subdivisions - 0.5) * this.size + this.fragmentSize * 0.5

                const i = (iX * this.subdivisions + iZ)
                const i3 = i * 3
                const i6 = i * 6

                // The blade stands somewhere inside its cell (random, so it is not a grid)
                const positionX = fragmentX + (Math.random() - 0.5) * this.fragmentSize
                const positionZ = fragmentZ + (Math.random() - 0.5) * this.fragmentSize

                // The same point for all 3 corners: the shader pulls them apart
                position[i6    ] = positionX
                position[i6 + 1] = positionZ
                position[i6 + 2] = positionX
                position[i6 + 3] = positionZ
                position[i6 + 4] = positionX
                position[i6 + 5] = positionZ

                heightRandomness[i3    ] = Math.random()
                heightRandomness[i3 + 1] = Math.random()
                heightRandomness[i3 + 2] = Math.random()
            }
        }

        this.geometry = new THREE.BufferGeometry()
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1) // Unused: frustum culling is off
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 2))
        this.geometry.setAttribute('heightRandomness', new THREE.Float32BufferAttribute(heightRandomness, 1))
    }

    setMaterial()
    {
        this.center = uniform(new THREE.Vector2()) // The middle of the window: follows the camera

        // Which corner of the triangle is this vertex? 0, 1 or 2
        const vertexLoopIndex = varying(vertexIndex.toFloat().mod(3))

        // 1 at the tip, 0 at the base. Smoothly blended in between, so it makes a gradient.
        const tipness = varying(step(vertexLoopIndex, 0.5))

        // THE MAP: what is under this blade? (the blade's position is filled in by the shader below)
        // grass amount 0..1: scales the blade (small at the edge of a patch), and below 0.5 it is hidden
        const bladePosition = varying(vec2())
        const terrainData = this.game.terrain.terrainNode(bladePosition)
        const terrainDataGrass = terrainData.g
        const hidden = step(terrainData.g.sub(0.4), 0.1) // 1 where the map has (almost) no grass

        this.bladeWidth = uniform(0.1)
        this.bladeHeight = uniform(0.6)
        this.bladeHeightRandomness = uniform(0.6)
        this.sizeUniform = uniform(this.size)

        // Corner shapes as (x, y) pairs: tip, bottom left, bottom right
        const bladeShape = uniformArray([
            0, 1,
            1, 0,
            - 1, 0,
        ])

        this.material = new THREE.MeshLambertNodeMaterial()
        this.material.side = THREE.DoubleSide

        // Colour: the SAME colour as the ground under it, so blades blend in. Darker at the root, lighter at the tip.
        this.material.colorNode = this.game.terrain.baseColorNode(terrainData).mul(mix(0.78, 1.15, tipness))

        // Light the blades as if they were flat ground (normal pointing up),
        // not as the tilted triangles they really are
        this.material.normalNode = transformNormalToView(vec3(0, 1, 0))

        this.material.positionNode = Fn(() =>
        {
            // Where this blade stands
            const position = attribute('position')

            // Wrap around: shift into the window around the camera, and loop what falls outside
            const loopPosition = position.sub(this.center).toVar()
            const halfSize = this.sizeUniform.mul(0.5)
            loopPosition.x.assign(mod(loopPosition.x.add(halfSize), this.sizeUniform).sub(halfSize))
            loopPosition.y.assign(mod(loopPosition.y.add(halfSize), this.sizeUniform).sub(halfSize))

            const worldPosition = vec3(loopPosition.x, 0, loopPosition.y).add(vec3(this.center.x, 0, this.center.y))
            bladePosition.assign(worldPosition.xz) // Now the map lookups above know where this blade is

            // Height: a base height, a random part per blade, and a slow variation across the field
            const heightVariation = sin(worldPosition.x.mul(0.21)).mul(sin(worldPosition.z.mul(0.27))).mul(0.35).add(1)
            const height = this.bladeHeight
                .mul(this.bladeHeightRandomness.mul(attribute('heightRandomness')).add(this.bladeHeightRandomness.oneMinus()))
                .mul(heightVariation)
                .mul(terrainDataGrass)

            // Pull the 3 corners apart into the blade's triangle shape
            const shape = vec3(
                bladeShape.element(vertexLoopIndex.mod(3).mul(2)).mul(this.bladeWidth).mul(terrainDataGrass),
                bladeShape.element(vertexLoopIndex.mod(3).mul(2).add(1)).mul(height),
                0
            )

            const vertexPosition = worldPosition.add(shape).toVar()

            // Turn the blade to face the camera, so it is never seen edge-on
            const angleToCamera = atan(worldPosition.z.sub(cameraPosition.z), worldPosition.x.sub(cameraPosition.x)).add(- Math.PI * 0.5)
            vertexPosition.xz.assign(rotateUV(vertexPosition.xz, angleToCamera, worldPosition.xz))

            // Wind: the tip sways, the base stays put. A travelling wave across the field.
            const sway = sin(time.mul(1.6).add(worldPosition.x.mul(0.4)).add(worldPosition.z.mul(0.3)))
            vertexPosition.x.addAssign(sway.mul(tipness).mul(height).mul(0.35))

            // No grass here: lift the blade far out of sight
            vertexPosition.y.addAssign(hidden.mul(100))

            return vertexPosition
        })()
    }

    setMesh()
    {
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false // The geometry's real position is decided in the shader
        this.mesh.receiveShadow = true // Blades catch shadows, so a tree's shadow darkens the grass too
        this.game.scene.add(this.mesh)
    }

    update()
    {
        const focus = this.game.view.focusPoint.smoothedPosition
        this.center.value.set(focus.x, focus.z)
    }
}
