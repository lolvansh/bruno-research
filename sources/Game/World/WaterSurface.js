import * as THREE from 'three/webgpu'
import { color, uniform, mix, smoothstep, sin, time, float, vec3, positionWorld } from 'three/tsl'
import { Game } from '../Game.js'

// Inspired by Bruno Simon's folio-2025 WaterSurface.js (MIT), see LICENSE-THIRD-PARTY.
// His surface blurs and refracts what is behind it, and has rain splashes and ice.
// Ours is the simple version of the same idea.
//
// ONE big flat plane at the water level, see-through. Where the ground is ABOVE it
// (the land) it is hidden by the ground, for free. Where the ground is BELOW it (the sea
// and ponds) you see the plane, and through it the sea floor, and the car's wheels.
//
// The plane is more see-through in shallow water and almost solid in deep water, and
// has white foam where the water is very shallow (along the shore).
export class WaterSurface
{
    constructor()
    {
        this.game = Game.getInstance()

        this.setMaterial()
        this.setMesh()
    }

    setMaterial()
    {
        const terrain = this.game.terrain
        const water = this.game.water

        const shallowColor = uniform(color('#5bc2b9'))
        const deepColor = uniform(color('#13375f'))

        // How deep is the water HERE, in world units? The map stores how far the floor sinks
        // (0 to 1, times 1.5). The water starts 0.3 below the land, so subtract that.
        const terrainData = terrain.terrainNode(positionWorld.xz)
        const waterDepth = terrainData.b.mul(terrain.depthScale).add(water.surfaceElevation)

        // Colour: teal where shallow, navy where deep
        const depthColor = mix(shallowColor, deepColor, smoothstep(0, 0.9, terrainData.b))

        // Foam. Two things:
        //  1. a thin solid white line right where the water meets the shore
        //  2. a few white bands drifting in and out, over the next few units of shallow water
        const shoreLine = float(1).sub(smoothstep(0.02, 0.1, waterDepth))
        const wave = sin(time.mul(1.3).add(waterDepth.mul(40)))
        const bands = smoothstep(0.6, 1, wave)
            .mul(smoothstep(0, 0.03, waterDepth))
            .mul(float(1).sub(smoothstep(0.08, 0.35, waterDepth)))
        const foam = shoreLine.add(bands).clamp(0, 1)

        // Blend white over the colour where there is foam. (A new value, not an assignment: shader
        // "assign" only works inside a Fn(), outside one it is silently ignored.)
        const waterColor = mix(depthColor, vec3(1), foam)

        // Opacity: you see through shallow water, deep water is nearly solid. Foam is solid.
        const opacity = mix(0.45, 0.92, smoothstep(0.2, 0.7, terrainData.b)).max(foam)

        // Unlit (Basic): the water gets its colour only from the above, not from the sun
        this.material = new THREE.MeshBasicNodeMaterial()
        this.material.transparent = true // Blend with what is behind it
        this.material.depthWrite = false // Do not hide things that are drawn after it
        this.material.colorNode = waterColor
        this.material.opacityNode = opacity
    }

    setMesh()
    {
        // Huge, so it reaches the horizon. Same trick as the sea floor.
        const geometry = new THREE.PlaneGeometry(1500, 1500)
        geometry.rotateX(- Math.PI * 0.5)

        this.mesh = new THREE.Mesh(geometry, this.material)
        this.mesh.position.y = this.game.water.surfaceElevation
        this.mesh.renderOrder = 1 // Draw after the solid things, which it blends over
        this.game.scene.add(this.mesh)
    }
}
