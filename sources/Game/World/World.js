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
        this.setKhaman()
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

    // THE SURAT KHAMAN THALI (khaman.glb, resources/make_thali.py). A big scalloped cream platter
    // (a loose body you can drive onto) holds 6 khaman pieces (one instanced mesh, each its own body) with
    // loose toppings on top, and a chutney bowl and an onion bowl sit on the ground beside it.
    setKhaman()
    {
        const scene = this.game.resources.khamanModel.scene
        const find = (name) => scene.children.find((child) => child.name.startsWith(name))

        // Where the thali sits: an open patch on the south bank
        const center = new THREE.Vector3(0, 0, - 50)

        // The eating-surface height of the platter (the khaman rest on this)
        const SURFACE = 0.24

        // THE PLATTER is a loose body you can push and throw, and you can DRIVE ONTO it. Its collision is built
        // from BOXES ONLY, on purpose. We tried a big many-sided solid for the ramp: anything lying flat on it
        // (khaman, a chili) got a single contact point, so it tipped, sank, spun and never fell asleep. Boxes
        // resting on boxes get solid contact on every corner and settle. (A trimesh cannot be used on a moving
        // body either: it has no mass.)
        const plateNode = find('servingPlatePhysical')

        // 1) The flat top, where the food sits: a few boxes that together cover the middle of the dish. Their
        //    bottoms are a little off the ground, so they never touch the terrain. [ x, z, half width, half depth ]
        const FLAT_BOTTOM = 0.04
        const flatBoxes = [
            [ 0, 0, 2.7, 1.8 ],      // the middle, where the six khaman stand
            [ 0, 2.2, 1.7, 0.4 ],    // a strip on each side of it, so toppings that land there rest on a flat box...
            [ 0, - 2.2, 1.7, 0.4 ],
            [ 2.85, 0, 0.15, 1.3 ],  // ... and a small cap at each end
            [ - 2.85, 0, 0.15, 1.3 ],
        ]
        const plateColliders = flatBoxes.map(([ x, z, hx, hz ]) => ({
            shape: 'cuboid',
            parameters: [ hx, (SURFACE - FLAT_BOTTOM) / 2, hz ],
            position: { x, y: FLAT_BOTTOM + (SURFACE - FLAT_BOTTOM) / 2, z }
        }))

        // 2) The ramp around it: a ring of thin boxes, each tilted to slope from the ground (r = 3.5) up to the
        //    height of the flat top (r = 3.0). A car with 0.4-radius wheels rolls straight up (about 22 degrees).
        const RAMP_COUNT = 16, RAMP_FOOT = 3.5, RAMP_TOP = 3.0, RAMP_THICKNESS = 0.05
        const rampFoot = RAMP_THICKNESS * 0.95 // a tilted box dips this far below its own surface: lift it so it stays off the ground
        const rampRise = SURFACE - rampFoot
        const rampAngle = Math.atan2(rampRise, RAMP_FOOT - RAMP_TOP)
        const rampLength = Math.hypot(RAMP_FOOT - RAMP_TOP, rampRise)

        // the box's middle: halfway along the slope surface, then half a thickness down into the box
        const rampRadius = (RAMP_FOOT + RAMP_TOP) / 2 - Math.sin(rampAngle) * RAMP_THICKNESS / 2
        const rampHeight = rampFoot + rampRise / 2 - Math.cos(rampAngle) * RAMP_THICKNESS / 2
        const rampHalfArc = Math.PI * rampRadius / RAMP_COUNT + 0.06 // each box a little wider than its slice, so the ring has no gaps

        for(let i = 0; i < RAMP_COUNT; i++)
        {
            const angle = (i / RAMP_COUNT) * Math.PI * 2

            // tilt it down towards the outside (a turn around its own z axis), then swing it round to its place
            const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), - angle)
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), - rampAngle))

            plateColliders.push({
                shape: 'cuboid',
                parameters: [ rampLength / 2 + 0.03, RAMP_THICKNESS / 2, rampHalfArc ],
                position: { x: Math.cos(angle) * rampRadius, y: rampHeight, z: Math.sin(angle) * rampRadius },
                quaternion
            })
        }

        this.servingPlate = this.game.objects.add({ model: plateNode }, {
            type: 'dynamic',
            position: new THREE.Vector3(center.x, 0, center.z),
            mass: 2.2,
            friction: 0.7,
            sleeping: true,
            colliders: plateColliders
        })

        // THE TWO BOWLS stand side by side, just beyond the platter. Each is a loose cylinder body, so
        // they can be shoved around and thrown. (Each model's base sits on y = 0.)
        const bowls = [
            { name: 'chutneyBowl', offset: [ - 1.1, 5.1 ], height: 0.82, radius: 1.0, centerX: 0 },
            { name: 'onionBowl',   offset: [ 1.1, 5.1 ],  height: 0.56, radius: 1.05, centerX: 0.17 },
        ]
        this.bowls = {}
        for(const { name, offset, height, radius, centerX } of bowls)
        {
            const node = find(name)
            if(!node) continue

            this.bowls[name] = this.game.objects.add({ model: node }, {
                type: 'dynamic',
                position: new THREE.Vector3(center.x + offset[0], 0, center.z + offset[1]),
                mass: 0.25,
                friction: 0.5,
                restitution: 0.2,
                sleeping: true,
                colliders: [ { shape: 'cylinder', parameters: [ height / 2, radius ], position: { x: centerX, y: height / 2, z: 0 } } ]
            })
        }

        // 6 khaman filling the plate (2 rows of 3), each its own body but one instanced mesh.
        // Each piece's collider is a 1.36 wide box. The spacing leaves room for it to be turned by up to
        // +-0.25 radians without touching its neighbours: boxes that overlap at the start make the physics
        // fight to push them apart as soon as they wake, which looks like endless vibration.
        const spots = [ [ - 1.8, - 0.875 ], [ 0, - 0.875 ], [ 1.8, - 0.875 ],
                        [ - 1.8, 0.875 ],   [ 0, 0.875 ],   [ 1.8, 0.875 ] ]

        // The LOOSE TOPPINGS (onion, chili, curry leaf, sev). Each one is its own node in the file; the node's
        // position is where it sits on one khaman. Every khaman gets its own full set, resting on its top.
        const toppingNodes = scene.children.filter((child) => /^(onion|chili|curryleaf|sev)PhysicalDynamic/.test(child.name))
        const toppingBuckets = toppingNodes.map(() => ({ nodes: [], places: [] }))
        const yAxis = new THREE.Vector3(0, 1, 0)

        const khNodes = [], khPlace = []
        for(const [ lx, lz ] of spots)
        {
            const yaw = (Math.random() - 0.5) * 0.5 // a little turn, so no two are lined up perfectly

            const piece = find('khamanPhysicalDynamic').clone(true)
            piece.position.set(0, SURFACE, 0) // rest on the platter surface
            khNodes.push(piece)
            khPlace.push([ center.x + lx, center.z + lz, yaw ])

            toppingNodes.forEach((node, i) =>
            {
                // Where this topping sits on the khaman, turned with the khaman, then moved to the khaman's place
                const offset = new THREE.Vector3(node.position.x, 0, node.position.z).applyAxisAngle(yAxis, yaw)

                const clone = node.clone(true)
                clone.position.y = SURFACE + node.position.y // its own height above the platter
                toppingBuckets[i].nodes.push(clone)
                toppingBuckets[i].places.push([ center.x + lx + offset.x, center.z + lz + offset.z, yaw ])
            })
        }

        this.khaman = this.addInstancedProps(khNodes, khPlace, {
            // Light on purpose: at 0.2 the car stopped dead against them (it arrived at speed 7.9 and dropped to 0).
            // At 0.06 it rolls straight through the dish and the khaman scatter ahead of it.
            mass: 0.06, sleeping: true, friction: 0.6, restitution: 0.1, ccd: true
        })

        // Very light and asleep until something touches them. Group 2 = "topping": they collide with the
        // khaman, the platter, the car and the ground, but not with each other (their boxes overlap a little).
        const TOPPING_GROUP = (0x0002 << 16) | 0xFFFD
        this.khamanToppings = toppingBuckets.map((bucket) =>
            this.addInstancedProps(bucket.nodes, bucket.places, {
                // angularDamping: a thrown leaf or chili stops turning instead of spinning on the ground forever
                mass: 0.008, sleeping: true, friction: 0.25, restitution: 0.3, collisionGroups: TOPPING_GROUP, ccd: true, angularDamping: 4
            })
        )

        // KEEP THE TOPPINGS AWAKE WHILE THEIR KHAMAN IS MOVING. Resting bodies fall asleep to save work, and
        // an asleep body does not notice when what it sits on slides away: the topping would hang in the
        // air. So every frame, if a khaman is really moving (it was hit, or its platter was pushed), we wake
        // its toppings. Only while it MOVES: a khaman that has stopped lets its toppings go back to sleep
        // too, otherwise they keep each other awake forever.
        // (khamanToppings[kind].objects[k] is the "kind" of topping that belongs to khaman number k.)
        this.khamanToppingsByPiece = this.khaman.objects.map((_, k) => this.khamanToppings.map((group) => group.objects[k]))

        // Priority 4: right after the physics step (3), so the very next step already sees them awake
        this.game.ticker.events.on('tick', () =>
        {
            this.khaman.objects.forEach((piece, k) =>
            {
                const body = piece.physical.body

                if(body.isSleeping())
                    return

                const v = body.linvel()
                const a = body.angvel()

                if(Math.hypot(v.x, v.y, v.z) < 0.05 && Math.hypot(a.x, a.y, a.z) < 0.1)
                    return

                for(const topping of this.khamanToppingsByPiece[k])
                    topping.physical.body.wakeUp()
            })

            // SAFETY NET: anything thrown out of the world (it would fall forever and stay awake) is switched
            // off and hidden. Nobody can see a speck of onion that is 10 metres under the island.
            for(const group of this.khamanToppings)
            {
                for(const object of group.objects)
                {
                    const body = object.physical.body

                    if(body.isEnabled() && body.translation().y < - 4)
                    {
                        body.setEnabled(false)
                        object.visual.object3D.scale.set(0, 0, 0)
                        object.visual.object3D.needsUpdate = true
                    }
                }
            }
        }, 4)

        this.keepClear.push({ x: center.x, z: center.z, radius: 9 })
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
