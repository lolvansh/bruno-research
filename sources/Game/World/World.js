import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { VisualVehicle } from './VisualVehicle.js'
import { InstancedGroup } from '../InstancedGroup.js'
import { Trees } from './Trees.js'
import { Foliage } from './Foliage.js'
import { Grass } from './Grass.js'
import { Floor } from './Floor.js'
import { WaterSurface } from './WaterSurface.js'
import { WaterEffects } from './WaterEffects.js'
import { createRandom } from '../utilities/random.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()

        // Circles where no trees may grow (landmarks and the placeholders fill this in)
        this.keepClear = []

        this.setFloor()
        this.setPlaceholders()
        this.setBenches()
        this.setFences()
        this.setCableBridge()
        this.setLandmarks()
        this.setVehicle()
        this.setWater()
        this.setTrees()
        this.setGrass()
    }

    // The car you see. It reads the physical car and copies it onto Bruno's model.
    setVehicle()
    {
        this.visualVehicle = new VisualVehicle(this.game.resources.vehicleModel.scene)
    }

    // Many copies of one model: ONE draw call (InstancedGroup), but each copy has its own
    // physics body, so each can be knocked about separately.
    //   nodes      = the copies in the GLB (the first is the shape; each one's size is kept)
    //   placements = [ x, z, yaw ] for each copy: where WE want it (Bruno scatters them over his world)
    addInstancedProps(nodes, placements, options)
    {
        const [ base, references ] = InstancedGroup.getBaseAndReferencesFromInstances(nodes)

        // The colliders come from the NAMES of the base's children (which are removed by this call).
        // Do it BEFORE touching the scale: the colliders must match the final size.
        const [ , physicalDescription ] = this.game.objects.getFromModel(base)

        // Each reference already carries the model's scale. If the base kept it too,
        // it would be applied twice.
        base.scale.set(1, 1, 1)
        this.game.materials.updateObject(base)

        // InstancedGroup copies these flags onto the instanced meshes it creates
        base.traverse((child) =>
        {
            if(child.isMesh)
            {
                child.castShadow = true
                child.receiveShadow = true
            }
        })

        const objects = references.map((reference, i) =>
        {
            const [ x, z, yaw ] = placements[i]

            reference.position.set(x, nodes[i].position.y, z)
            reference.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

            return this.game.objects.add(
                {
                    model: reference,
                    updateMaterials: false, // base already has our materials
                    parent: null // Not drawn on its own: the InstancedGroup draws it
                },
                {
                    type: physicalDescription.type,
                    position: reference.position,
                    rotation: reference.quaternion,
                    colliders: physicalDescription.colliders,
                    ...options
                }
            )
        })

        return { objects, group: new InstancedGroup(references, base) }
    }

    // Bruno's 7 benches (benches.glb). Each is a node named "benchPhysicalDynamic" with
    // two "cuboid" children: the names ARE the collision shapes (step 8).
    setBenches()
    {
        const nodes = this.game.resources.benchesModel.scene.children.filter((child) => child.name.startsWith('benchPhysical'))

        // x, z, and which way each one faces (radians). Scattered through the city on the south bank.
        const placements = [
            [ 6, -10, 0 ], [ -6, -12, Math.PI * 0.5 ], [ 16, -22, Math.PI * 0.25 ], [ 8, -26, 0.3 ],
            [ -10, -22, 2 ], [ 2, -40, 1 ], [ -14, -32, 4 ],
        ]

        this.benches = this.addInstancedProps(nodes, placements, {
            friction: 0.7,
            mass: 0.1, // Light: the car pushes them easily
            sleeping: true // At rest until something touches them
        })
    }

    // Bruno's 16 fence pieces (fences.glb, Draco-compressed), as a two-row pen
    // right in the car's path.
    setFences()
    {
        const nodes = this.game.resources.fencesModel.scene.children.filter((child) => child.name.startsWith('fencePhysical'))

        // Two rows of 8, a little pen on the south bank west of the plaza
        const placements = nodes.map((node, i) => [ - 10 - Math.floor(i / 8) * 3, - 8 - (i % 8) * 2.4, Math.PI * 0.5 ])

        this.fences = this.addInstancedProps(nodes, placements, {
            friction: 0.7,
            mass: 0.1,
            sleeping: true
        })
    }

    // Trees grow in GROVES: a handful of clusters on grassy land, not spread evenly.
    // The terrain map tells us where the land is and where it is green, so we ask it.
    setTrees()
    {
        const terrain = this.game.terrain
        const resources = this.game.resources
        const random = createRandom(99)

        // Is this a good place for a plant? Dry land, no paving, enough grass.
        const isGood = (x, z, minGrass) =>
        {
            const [ paving, grass, depth ] = terrain.sample(x, z)

            if(depth >= 0.01 || paving >= 0.1 || grass <= minGrass)
                return false

            // Keep clear of the landmarks and the bridge
            return !this.keepClear.some((zone) => Math.hypot(zone.x - x, zone.z - z) < zone.radius)
        }

        // 1. Choose the grove centres: random spots on very grassy land, not too close together
        const groves = []

        for(let attempt = 0; attempt < 1000 && groves.length < 9; attempt++)
        {
            const x = (random() - 0.5) * 150
            const z = (random() - 0.5) * 150

            if(!isGood(x, z, 0.8))
                continue

            if(groves.some((grove) => Math.hypot(grove.x - x, grove.z - z) < 24))
                continue

            groves.push({ x, z })
        }

        // 2. Plant the trees. Each grove has a favourite kind, plus some of the others.
        const kinds = [
            { name: 'birch', colorA: '#ff4f2b', colorB: '#ff903f', references: [] },
            { name: 'oak', colorA: '#b4b536', colorB: '#d8cf3b', references: [] },
            { name: 'cherry', colorA: '#ff6d6d', colorB: '#ff9990', references: [] },
        ]
        const planted = [] // Every tree's spot, to keep them apart

        for(const grove of groves)
        {
            const favourite = Math.floor(random() * kinds.length)
            const wanted = 5 + Math.floor(random() * 5)
            let count = 0

            for(let attempt = 0; attempt < wanted * 10 && count < wanted; attempt++)
            {
                // A random spot within 10 units of the centre
                const angle = random() * Math.PI * 2
                const radius = Math.sqrt(random()) * 10
                const x = grove.x + Math.cos(angle) * radius
                const z = grove.z + Math.sin(angle) * radius

                if(!isGood(x, z, 0.4))
                    continue

                if(planted.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 3.6))
                    continue

                const reference = new THREE.Object3D() // Only a position and a turn. Trees reads these.
                reference.position.set(x, 0, z)
                reference.rotation.y = random() * Math.PI * 2

                kinds[random() < 0.65 ? favourite : Math.floor(random() * kinds.length)].references.push(reference)
                planted.push({ x, z })
                count++
            }
        }

        this.groves = groves
        this.trees = kinds
            .filter((kind) => kind.references.length > 0)
            .map((kind) => new Trees(resources[`${kind.name}TreesVisualModel`].scene, kind.references, kind.colorA, kind.colorB))

        // 3. Bushes: a few around every grove, and some on their own
        const bushes = []

        const addBush = (x, z) =>
        {
            const scale = 0.75 + random() * 0.35

            const reference = new THREE.Object3D()
            reference.position.set(x, scale * 0.7, z) // The cluster is a ball: raise it so it sits ON the ground
            reference.scale.setScalar(scale)
            bushes.push(reference)
        }

        for(const grove of groves)
        {
            const wanted = 3 + Math.floor(random() * 4)

            for(let attempt = 0; attempt < wanted * 8 && bushes.length < 400; attempt++)
            {
                const angle = random() * Math.PI * 2
                const radius = 4 + Math.sqrt(random()) * 9
                const x = grove.x + Math.cos(angle) * radius
                const z = grove.z + Math.sin(angle) * radius

                if(isGood(x, z, 0.5) && !planted.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 2.2))
                    addBush(x, z)
            }
        }

        for(let attempt = 0; attempt < 400 && bushes.length < 90; attempt++)
        {
            const x = (random() - 0.5) * 160
            const z = (random() - 0.5) * 160

            if(isGood(x, z, 0.6) && !planted.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 2.2))
                addBush(x, z)
        }

        this.bushes = new Foliage(bushes, '#b4b536', '#d8cf3b')
    }

    setGrass()
    {
        this.grass = new Grass()
    }

    // A model built IN CODE with exactly the structure a Blender export would have:
    // a visible mesh, with child objects whose NAMES describe the collision shapes.
    // `colliders`: [ { name, scale: [x, y, z], geometry?, userData? } ]
    createNamedModel(name, geometry, paletteIndex, colliders)
    {
        const mesh = new THREE.Mesh(this.game.materials.paint(geometry, paletteIndex), this.game.materials.palette)
        mesh.name = name

        for(const collider of colliders)
        {
            const child = new THREE.Mesh(collider.geometry ?? new THREE.BufferGeometry())
            child.name = collider.name
            child.scale.set(...collider.scale)
            Object.assign(child.userData, collider.userData ?? {})
            mesh.add(child)
        }

        return mesh
    }

    // Surat's Cable Bridge (a toy version, made by resources/make_cable_bridge.py).
    // The model is ONE node named "cableBridgePhysical" with box and hull children: the same
    // naming convention as the benches, so addFromModel builds the physics from the names.
    // It crosses the river at x = 0, its road running north-south (the only way to the far bank).
    setCableBridge()
    {
        const model = this.game.resources.cableBridgeModel.scene.children.find((child) => child.name.startsWith('cableBridgePhysical'))

        // The model's own x axis is the road. Turn it a quarter so the road runs along game z (north-south),
        // across the east-west river.
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), - Math.PI * 0.5)

        this.cableBridge = this.game.objects.addFromModel(model, {}, {
            position: new THREE.Vector3(0, 0, this.game.terrain.riverCenterAt(0)),
            rotation: rotation,
            friction: 0.7
        })

        // The cables and pylons dissolve around the car when they are between it and the camera
        this.game.materials.makeSeeThrough(this.cableBridge.visual.object3D)

        // Keep trees and bushes off the bridge and its ramps (they grow to the sides instead)
        this.keepClear.push({ x: 0, z: this.game.terrain.riverCenterAt(0), radius: 7 })
    }

    // MINI SURAT. The landmarks all live in one file (landmarks.glb, made by resources/make_landmarks.py).
    // Each is a node named "<name>Physical" with invisible box/tube/ball children: the same naming
    // convention as the benches and the bridge, so addFromModel builds the physics from the names.
    //
    // Where each one stands: a spot on dry land that the terrain map confirmed (x, z), and which way
    // its FRONT (+X in the model) points. 'inland' = towards the middle of the island.
    // radius = how far from its middle we keep trees away.
    setLandmarks()
    {
        const nodes = this.game.resources.landmarksModel.scene.children
        const centre = this.game.terrain.island

        // SOUTH BANK = the city (near the spawn). FAR BANK (z > 20) = across the cable bridge.
        // X matches the hand-drawn map: the city buildings on the left, the empty/east spots on the right.
        // Positions sit just OFF the roads (you drive up to them), except the Gate, which the road runs through.
        const places = [
            // South bank
            { name: 'vrSurat',            x: 38.2, z: - 18.2, radius: 6 },  // Vesu / Piplod: the big mall
            { name: 'rahulRajMall',       x: 14.7, z: - 29.7, radius: 5 },  // Piplod: the tall glass tower
            { name: 'dumasBeach',         x: 40.3, z: - 29,   radius: 7 },  // Dumas: sign, umbrellas, lifeguard tower
            // Far bank (the other side of the bridge)
            { name: 'athwaGate',          x: 0,    z: 26,     radius: 7 },  // Athwa: drive through the arch, straight off the bridge
            { name: 'scienceCentre',      x: 26,   z: 32,     radius: 6 },  // City Light: the dome
            { name: 'dariyaGaneshTemple', x: - 26, z: 28,     radius: 5 },  // Dumas: the seaside temple
        ]

        this.landmarks = {}

        for(const place of places)
        {
            const model = nodes.find((node) => node.name.startsWith(`${place.name}Physical`))

            if(!model)
            {
                console.warn(`World: landmark "${place.name}" is not in landmarks.glb`)
                continue
            }

            // Turn the model so its front (+X) looks at the middle of the island.
            // (Rotating by "yaw" around the up axis turns +X towards (cos yaw, -sin yaw).)
            const yaw = Math.atan2(centre.z - place.z, centre.x - place.x) * - 1
            const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

            this.landmarks[place.name] = this.game.objects.addFromModel(model, {}, {
                position: new THREE.Vector3(place.x, 0, place.z),
                rotation: rotation,
                friction: 0.7
            })

            // Tall things dissolve around the car when they stand between it and the camera
            this.game.materials.makeSeeThrough(this.landmarks[place.name].visual.object3D)

            this.keepClear.push({ x: place.x, z: place.z, radius: place.radius })
        }
    }

    // A box painted with one palette swatch.
    // type: 'fixed' (solid, never moves), 'dynamic' (falls and gets pushed), or null (no physics)
    addBlock(size, position, paletteIndex, type = null, rotation = null)
    {
        const geometry = this.game.materials.paint(new THREE.BoxGeometry(...size), paletteIndex)
        const mesh = new THREE.Mesh(geometry, this.game.materials.palette)
        mesh.position.set(...position)

        if(type === null)
        {
            this.game.scene.add(mesh)
            return mesh
        }

        // The physics shape must match the visible one. Rapier takes HALF the size
        // on each axis (distance from the centre to a face).
        this.game.objects.add(
            { model: mesh },
            {
                type: type,
                position: { x: position[0], y: position[1], z: position[2] },
                rotation: rotation ?? undefined,
                colliders: [ { shape: 'cuboid', parameters: [ size[0] * 0.5, size[1] * 0.5, size[2] * 0.5 ] } ]
            }
        )

        return mesh
    }

    // The see-through water over the sea and ponds, plus the splashes and ripples the car makes in it
    setWater()
    {
        this.waterSurface = new WaterSurface()
        this.waterEffects = new WaterEffects()
    }

    // The island's ground: shape, colour and physics all come from the Terrain map (see Floor.js)
    setFloor()
    {
        this.floor = new Floor()
    }

    // MAP v1 PLACEHOLDERS (the boxes on the hand-drawn map).
    //  - Labelled spots I have no model for yet (tea stall, locho house, airport): one tall block each,
    //    in a warm colour, so the spot is reserved. These become real models later.
    //  - The map's blank boxes: a little stack of plain cubes ("just put cubes there").
    setPlaceholders()
    {
        // Reserved building spots (south bank, among the city). [x, z, size]
        const buildings = [
            { name: 'teaStall',   x: 23.8, z: 0.8,   size: [ 3, 3, 3 ],   palette: 7 },  // peach
            { name: 'lochoHouse', x: 12.5, z: - 17.1, size: [ 4, 3.5, 4 ], palette: 8 },  // yellow
            { name: 'airport',    x: 22,   z: - 30.5, size: [ 7, 2.5, 5 ], palette: 4 },  // light grey terminal
        ]

        this.placeholders = {}

        for(const b of buildings)
        {
            this.placeholders[b.name] = this.addBlock(b.size, [ b.x, b.size[1] / 2, b.z ], b.palette, 'fixed')
            this.keepClear.push({ x: b.x, z: b.z, radius: Math.max(b.size[0], b.size[2]) * 0.5 + 3 })
        }

        // The map's blank boxes: a stack of three plain cubes at each spot
        const cubeSpots = [ [ - 18, - 10 ], [ - 21, - 34.3 ], [ - 34, 24 ], [ - 38.3, - 23 ] ]

        for(const [ x, z ] of cubeSpots)
        {
            this.addBlock([ 2, 2, 2 ], [ x, 1, z ], 6, 'fixed')
            this.addBlock([ 1.4, 1.4, 1.4 ], [ x + 1.2, 0.7, z + 0.6 ], 20, 'fixed')
            this.addBlock([ 1.2, 1.2, 1.2 ], [ x - 0.4, 0.6, z - 1.3 ], 21, 'fixed')
            this.keepClear.push({ x, z, radius: 5 })
        }
    }

}
