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

        // Circles where no trees may grow (landmarks and the bridge fill this in)
        this.keepClear = [ { x: - 26, z: - 18, radius: 14 } ]

        this.setFloor()
        this.setTestBlocks()
        this.setBenches()
        this.setFences()
        this.setNamedShapes()
        this.setCableBridge()
        this.setLandmarks()
        this.setVehicle()
        this.setWater()
        this.setTrees()
        this.setGrass()
        this.setBoxDropper()

        // Priority 10: the dropper timer. (Nothing here must run before physics.)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
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

        // x, z, and which way each one faces (radians)
        const placements = [
            [ -4, 6, 0 ], [ 4, 6, Math.PI * 0.5 ], [ -14, 6, Math.PI * 0.25 ], [ -8, -2, 0.3 ],
            [ 10, -2, 2 ], [ -2, -8, 1 ], [ 16, -6, 4 ],
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

        // Two rows of 8 along Z, at x = 24 and x = 27, long side across the car's path
        const placements = nodes.map((node, i) => [ 24 + Math.floor(i / 8) * 3, 3 + (i % 8) * 2.4, Math.PI * 0.5 ])

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

    // One model per collider type, to test the whole naming convention without Blender.
    // Each is ADDED THE SAME WAY as the benches: addFromModel reads the names.
    setNamedShapes()
    {
        const objects = this.game.objects
        const identity = () => new THREE.Quaternion()

        // trimesh: a ramp. The car must be able to DRIVE UP it: this is the same
        // situation as the deck of your Cable Bridge.
        // 6 corner points, and which three make each triangle:
        const rampPoints = new Float32Array([ 0, 0, - 2,   8, 0, - 2,   8, 0, 2,   0, 0, 2,   8, 2, - 2,   8, 2, 2 ])
        const rampTriangles = [ 0, 1, 2,  0, 2, 3,  1, 4, 5,  1, 5, 2,  0, 3, 5,  0, 5, 4,  0, 4, 1,  3, 2, 5 ]

        const rampCollider = new THREE.BufferGeometry()
        rampCollider.setAttribute('position', new THREE.Float32BufferAttribute(rampPoints, 3))
        rampCollider.setIndex(rampTriangles)

        // The visible ramp: same shape, but not indexed so every face is flat-shaded
        const rampVisual = rampCollider.clone().toNonIndexed()
        rampVisual.computeVertexNormals()
        rampVisual.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(rampVisual.attributes.position.count * 2), 2))

        const ramp = this.createNamedModel('rampPhysical', rampVisual, 15, [
            { name: 'trimesh_ramp', scale: [ 1, 1, 1 ], geometry: rampCollider },
        ])
        objects.addFromModel(ramp, {}, { position: new THREE.Vector3(8, 0, 12), rotation: identity(), friction: 0.5 })

        // tube: a round pillar. scale.y = height, scale.x = diameter.
        const pillar = this.createNamedModel('pillarPhysical', new THREE.CylinderGeometry(0.8, 0.8, 4, 20), 4, [
            { name: 'tube_pillar', scale: [ 1.6, 4, 1.6 ] },
        ])
        objects.addFromModel(pillar, {}, { position: new THREE.Vector3(- 6, 2, 24), rotation: identity() })

        // ball: a bouncy boulder you can push. "Dynamic" in the name, and a custom
        // property (restitution) on the collider child, exactly like a Blender custom property.
        const boulder = this.createNamedModel('boulderPhysicalDynamic', new THREE.SphereGeometry(1, 20, 14), 20, [
            { name: 'ball_boulder', scale: [ 2, 2, 2 ], userData: { restitution: 0.7 } },
        ])
        objects.addFromModel(boulder, {}, { position: new THREE.Vector3(6, 3, 22), rotation: identity(), mass: 0.4 })

        // hull: a rock. The collider wraps the same points as the visible rock.
        const rock = this.createNamedModel('rockPhysicalDynamic', new THREE.DodecahedronGeometry(1.2), 13, [
            { name: 'hull_rock', scale: [ 1, 1, 1 ], geometry: new THREE.DodecahedronGeometry(1.2) },
        ])
        objects.addFromModel(rock, {}, { position: new THREE.Vector3(- 14, 3, 20), rotation: identity(), mass: 0.3 })
    }

    // Surat's Cable Bridge (a toy version, made by resources/make_cable_bridge.py).
    // The model is ONE node named "cableBridgePhysical" with box and hull children: the same
    // naming convention as the benches, so addFromModel builds the physics from the names.
    // It crosses the pond to the north-west, with the road running along the pond's edge direction.
    setCableBridge()
    {
        const model = this.game.resources.cableBridgeModel.scene.children.find((child) => child.name.startsWith('cableBridgePhysical'))

        // The model's own x axis is the road. Turn it to run across the pond (pond centre: -26, -18).
        const angle = Math.atan2(28, 32) + Math.PI * 0.5
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), - angle)

        this.cableBridge = this.game.objects.addFromModel(model, {}, {
            position: new THREE.Vector3(- 26, 0, - 18),
            rotation: rotation,
            friction: 0.7
        })

        // The cables and pylons dissolve around the car when they are between it and the camera
        this.game.materials.makeSeeThrough(this.cableBridge.visual.object3D)
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

        const places = [
            { name: 'vrSurat',            x: 36,    z: 14,    radius: 6 },  // Vesu / Piplod: the big mall
            { name: 'rahulRajMall',       x: 24,    z: 32,    radius: 5 },  // Piplod: the tall glass tower
            { name: 'athwaGate',          x: 16,    z: 30,    radius: 7 },  // Athwa: drive through the arch
            { name: 'scienceCentre',      x: -16,   z: 32,    radius: 6 },  // City Light: the dome
            { name: 'dumasBeach',         x: 22.9,  z: -34.9, radius: 7 },  // Dumas: sign, umbrellas, lifeguard tower
            { name: 'dariyaGaneshTemple', x: 1.3,   z: -23.7, radius: 5 },  // Dumas: the seaside temple
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

    // TEMPORARY: a few coloured blocks, solid, so you have things to drive around and bump into
    setTestBlocks()
    {
        this.addBlock([ 4, 2, 4 ], [ -12, 1, -6 ], 1, 'fixed') // cream
        this.addBlock([ 3, 3, 3 ], [ 14, 1.5, 8 ], 14, 'fixed') // terracotta
        this.addBlock([ 6, 1.5, 2 ], [ -6, 0.75, 14 ], 3, 'fixed') // sky blue
        this.addBlock([ 2, 2, 2 ], [ 8, 1, -14 ], 8, 'fixed') // yellow
        this.addBlock([ 1, 4, 1 ], [ 0, 2, 0 ], 19, 'fixed') // crimson pillar in the middle
    }

    // TEMPORARY: rain boxes on the world so you can watch the physics work
    // and push them around with the car.
    setBoxDropper()
    {
        this.dropped = 0
        this.maxDropped = 20
        this.dropTimer = 0
        this.dropPalette = [ 1, 3, 8, 14, 18, 20, 21 ] // swatches to pick from
    }

    dropBox()
    {
        const size = 0.8 + Math.random() * 0.6

        // A random starting tilt, so they land messily
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3))

        this.addBlock(
            [ size, size, size ],
            [ (Math.random() - 0.5) * 16, 8 + Math.random() * 4, (Math.random() - 0.5) * 16 ],
            this.dropPalette[Math.floor(Math.random() * this.dropPalette.length)],
            'dynamic',
            rotation
        )

        this.dropped++
    }

    update()
    {
        // One new box every half second, up to the limit
        this.dropTimer += this.game.ticker.delta
        if(this.dropTimer > 0.5 && this.dropped < this.maxDropped)
        {
            this.dropTimer = 0
            this.dropBox()
        }
    }
}
