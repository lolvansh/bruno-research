import * as THREE from 'three/webgpu'
import { Fn, texture, uniform, color, mix, smoothstep, positionWorld } from 'three/tsl'
import { Game } from './Game.js'
import { createNoise } from './utilities/noise.js'

// Inspired by Bruno Simon's folio-2025 Terrain.js (MIT), see LICENSE-THIRD-PARTY.
// His island is a hand-painted 512x512 image. Ours is GENERATED in code, but uses
// the same idea: a map where each COLOUR CHANNEL means something.
//
//   red   = paving     (the plaza and the paths)       0 = none, 1 = fully paved
//   green = grass                                      0 = bare ground, 1 = full grass
//   blue  = water depth                                0 = dry land, 1 = deep sea
//
// The map covers a 192 x 192 square centred on the world's origin. Everything that
// needs to know "what is at this spot?" (the floor colour, the floor shape, the
// physics, the grass, where trees may grow) asks this one map.
//
// Later you can paint your own map in an image editor, with the same channels,
// and load it instead of generating it. Nothing else would change.
export class Terrain
{
    constructor()
    {
        this.game = Game.getInstance()

        this.size = 192 // World units covered by the map
        this.segments = 128 // The floor mesh and the physics are a grid of 128 x 128 squares
        this.textureSize = 256 // The map image is 256 x 256 pixels
        this.depthScale = 1.5 // How far the sea floor sinks below the land

        // Where the island is, and what is on it
        this.island = { x: 6, z: 10 }
        this.ponds = [
            { x: - 26, z: - 18, radius: 8 },
            { x: 44, z: 40, radius: 6 },
        ]
        this.pathAngles = [ - 0.5, 1.9, 3.7 ] // Directions the three paths leave the plaza (radians)

        this.noise = createNoise(7)

        this.setData()
        this.setNodes()
    }

    // 0 below edge0, 1 above edge1, a smooth ramp between
    static smoothstep(edge0, edge1, x)
    {
        const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)

        return t * t * (3 - 2 * t)
    }

    // THE MAP, as a function: what is at world position (x, z)?
    // Returns [ paving, grass, depth ], each from 0 to 1.
    sample(x, z)
    {
        const smoothstep = Terrain.smoothstep
        const noise = this.noise

        const distance = Math.hypot(x - this.island.x, z - this.island.z)
        const angle = Math.atan2(z - this.island.z, x - this.island.x)

        // The coast: a circle whose radius wobbles with noise, so the island is not round.
        // Depth ramps from 0 (the shore) to 1 (deep sea) over 14 units.
        const coast = distance + (noise.fbm(x * 0.045, z * 0.045, 3) - 0.5) * 24
        let depth = smoothstep(56, 70, coast)

        // Ponds: round dips inside the land, shallower than the sea
        for(const pond of this.ponds)
        {
            const pondDistance = Math.hypot(x - pond.x, z - pond.z) + (noise.fbm(x * 0.12 + 3, z * 0.12 + 3, 2) - 0.5) * 5
            const pondDepth = (1 - smoothstep(pond.radius - 3, pond.radius + 2, pondDistance)) * 0.55

            depth = Math.max(depth, pondDepth)
        }

        // Paving, part 1: a round plaza in the middle (our playground is on it)
        const plaza = 1 - smoothstep(25, 31, distance + (noise.fbm(x * 0.08 + 9, z * 0.08 + 9, 2) - 0.5) * 7)

        // Paving, part 2: three winding paths leaving the plaza.
        // For each: how far sideways is this point from the path's centre line?
        let paths = 0

        this.pathAngles.forEach((pathAngle, i) =>
        {
            const wiggle = Math.sin(distance * 0.09 + i * 2) * 0.22
            let delta = angle - pathAngle - wiggle
            delta = Math.atan2(Math.sin(delta), Math.cos(delta)) // Wrap into -PI..PI

            const sideways = Math.abs(delta) * distance // Angle times radius = distance in world units
            const along = smoothstep(20, 26, distance) * (1 - smoothstep(50, 58, distance)) // Only between plaza and shore

            paths = Math.max(paths, (1 - smoothstep(1.8, 2.8, sideways)) * along)
        })

        const dryness = 1 - smoothstep(0, 0.05, depth) // 1 on dry land, 0 in water
        const paving = Math.max(plaza, paths) * dryness

        // Grass: patches where a slow noise is high. Not on paving, not in water.
        const grassNoise = noise.fbm(x * 0.055 + 20, z * 0.055 + 20, 4)
        const grass = smoothstep(0.47, 0.6, grassNoise) * dryness * (1 - paving)

        return [ paving, grass, depth ]
    }

    // How high is the ground at (x, z)? The land is flat at 0; the sea floor sinks.
    heightAt(x, z)
    {
        return - this.sample(x, z)[2] * this.depthScale
    }

    // Bake the map into a texture (for the GPU) and a height grid (for the physics)
    setData()
    {
        const size = this.textureSize
        const data = new Uint8Array(size * size * 4)

        for(let iz = 0; iz < size; iz++)
        {
            for(let ix = 0; ix < size; ix++)
            {
                // World position of the CENTRE of this pixel
                const x = ((ix + 0.5) / size - 0.5) * this.size
                const z = ((iz + 0.5) / size - 0.5) * this.size

                const [ paving, grass, depth ] = this.sample(x, z)

                const i = (iz * size + ix) * 4
                data[i    ] = Math.round(paving * 255)
                data[i + 1] = Math.round(grass * 255)
                data[i + 2] = Math.round(depth * 255)
                data[i + 3] = 255
            }
        }

        this.dataTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
        this.dataTexture.minFilter = THREE.LinearFilter // Smooth between pixels
        this.dataTexture.magFilter = THREE.LinearFilter
        this.dataTexture.generateMipmaps = false
        this.dataTexture.wrapS = THREE.ClampToEdgeWrapping // Outside the map: repeat the edge pixel (deep sea)
        this.dataTexture.wrapT = THREE.ClampToEdgeWrapping
        this.dataTexture.needsUpdate = true

        // Heights for the physics: (segments + 1) x (segments + 1) points.
        // Rapier wants them in one list, ordered: index = z * 1 + x * (segments + 1)
        const points = this.segments + 1
        const cell = this.size / this.segments

        this.heights = new Float32Array(points * points)

        for(let ix = 0; ix < points; ix++)
        {
            for(let iz = 0; iz < points; iz++)
            {
                this.heights[iz + ix * points] = this.heightAt(- this.size / 2 + ix * cell, - this.size / 2 + iz * cell)
            }
        }
    }

    // THE MAP, for shaders: terrainNode(worldXZ) gives (paving, grass, depth, 1)
    setNodes()
    {
        this.dirtColor = uniform(color('#ffa94e'))
        this.shallowColor = uniform(color('#5bc2b9'))
        this.deepColor = uniform(color('#13375f'))
        this.grassColor = uniform(color('#b8b62e'))
        this.slabLowColor = uniform(color('#a87762'))
        this.slabHighColor = uniform(color('#ffcf8b'))

        this.terrainNode = Fn(([ position ]) =>
        {
            return texture(this.dataTexture, position.div(this.size).add(0.5))
        })

        // The colour of the ground itself: dirt on land, teal in shallow water, navy in deep water,
        // tinted olive where there is grass. (The grass blades use this too, so they blend in.)
        this.baseColorNode = Fn(([ terrainData ]) =>
        {
            const depth = terrainData.b

            // The land stays dirt down to the waterline (depth 0.2 = the water surface), and only
            // UNDER water does it turn teal, then navy. The water surface is drawn on top of this.
            const baseColor = mix(this.dirtColor, this.shallowColor, smoothstep(0.15, 0.4, depth)).toVar()
            baseColor.assign(mix(baseColor, this.deepColor, smoothstep(0.3, 0.95, depth)))
            baseColor.assign(mix(baseColor, this.grassColor, terrainData.g))

            return baseColor
        })

        // The full colour of the FLOOR: the above, plus paving on top. (The shore foam is on the water surface now.)
        this.floorColorNode = Fn(() =>
        {
            const terrainData = this.terrainNode(positionWorld.xz)
            const depth = terrainData.b

            const floorColor = this.baseColorNode(terrainData).toVar()

            // Paving: a tiled texture, coloured between two tones, laid over everything
            const slabPattern = texture(this.game.resources.floorSlabsTexture, positionWorld.xz.mul(0.175)).r
            const slabColor = mix(this.slabLowColor, this.slabHighColor, slabPattern)
            floorColor.assign(mix(floorColor, slabColor, terrainData.r))

            return floorColor
        })
    }
}
