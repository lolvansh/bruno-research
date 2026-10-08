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

        // Where the island is, and what is on it. The city sits on the SOUTH bank (lower z),
        // the river runs east-west through the middle, and the far bank (higher z) is across the bridge.
        this.island = { x: 0, z: - 14 }
        this.ponds = []

        // The Tapi: an east-west river. riverCenterAt(x) is its wavy middle line; the only way
        // across is the cable bridge (at x = 0), so the far bank can only be reached by crossing it.
        // halfWidth 4 keeps the water band (~14 wide) just narrow enough for the bridge to span.
        this.river = { centerZ: 8, halfWidth: 4, depth: 0.7 }

        // ROADS (the red/paving channel, like Bruno's hand-painted paths). Each road is a list of
        // [x, z] points joined by straight strips. Over the river the paving vanishes, so the bridge
        // is the crossing. Positions match the landmarks in World.js.
        this.roadHalfWidth = 1.5
        this.roads = [
            // FAR BANK: the bridge spine up to the Athwa Gate, then branching to the two models
            [ [ 0, 16 ], [ 0, 26 ] ],
            [ [ 0, 18 ], [ 22, 30 ] ],   // -> up to (not into) the Science Centre
            [ [ 0, 18 ], [ - 22, 26 ] ], // -> up to (not into) the temple

            // SOUTH BANK road network (follows the hand-drawn red loops). All feed the central junction,
            // which the bridge spine connects to the far bank.
            [ [ 0, 0 ], [ 0, - 10 ] ],   // bridge spine down to the central junction

            // Outer perimeter loop around the whole south bank
            [ [ 6, - 2 ], [ 40, - 6 ], [ 50, - 20 ], [ 44, - 40 ], [ 22, - 50 ], [ - 6, - 52 ], [ - 32, - 44 ], [ - 44, - 22 ], [ - 34, - 6 ], [ - 8, - 3 ], [ 6, - 2 ] ],
            [ [ 0, - 2 ], [ 6, - 2 ] ], [ [ 0, - 2 ], [ - 8, - 3 ] ], // junction -> outer loop

            // Two inner loops (the figure-of-eight)
            [ [ 0, - 10 ], [ 22, - 12 ], [ 34, - 24 ], [ 24, - 40 ], [ 4, - 42 ], [ - 4, - 28 ], [ 0, - 10 ] ],
            [ [ 0, - 10 ], [ - 16, - 16 ], [ - 30, - 26 ], [ - 22, - 42 ], [ - 4, - 44 ], [ 4, - 28 ], [ 0, - 10 ] ],

            // Diagonal cross-connectors, so the loops cross like the drawing
            [ [ 40, - 10 ], [ - 22, - 40 ] ],
            [ [ - 30, - 12 ], [ 28, - 44 ] ],
        ]

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

    // The z of the river's wavy centre line at a given x. The bridge is placed on it.
    riverCenterAt(x)
    {
        return this.river.centerZ + Math.sin(x * 0.035) * 5 + (this.noise.fbm(x * 0.06 + 40, 7, 2) - 0.5) * 4
    }

    // Shortest distance from point (px, pz) to the line segment a-b
    static distanceToSegment(px, pz, ax, az, bx, bz)
    {
        const dx = bx - ax
        const dz = bz - az
        const lengthSq = dx * dx + dz * dz
        let t = lengthSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lengthSq : 0
        t = Math.max(0, Math.min(1, t))

        return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
    }

    // How "on a road" is this point? 1 on the centre line, fading to 0 just past the edge.
    roadAt(x, z)
    {
        let road = 0

        for(const line of this.roads)
        {
            for(let i = 0; i < line.length - 1; i++)
            {
                const d = Terrain.distanceToSegment(x, z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1])
                road = Math.max(road, 1 - Terrain.smoothstep(this.roadHalfWidth, this.roadHalfWidth + 0.9, d))
            }
        }

        return road
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

        // The river: a band of water around its wavy centre line. Deep in the middle, shelving to the banks.
        const river = this.river
        const riverDistance = Math.abs(z - this.riverCenterAt(x))
        const riverDepth = (1 - smoothstep(river.halfWidth - 2, river.halfWidth + 3, riverDistance)) * river.depth

        depth = Math.max(depth, riverDepth)

        // Paving, part 1: a small paved patch around the spawn (the island centre)
        const plaza = 1 - smoothstep(4, 7, distance + (noise.fbm(x * 0.08 + 9, z * 0.08 + 9, 2) - 0.5) * 3)

        // Paving, part 2: the roads (the drawn road loop + the spine to the bridge)
        const roads = this.roadAt(x, z)

        const dryness = 1 - smoothstep(0, 0.05, depth) // 1 on dry land, 0 in water
        const paving = Math.max(plaza, roads) * dryness

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
