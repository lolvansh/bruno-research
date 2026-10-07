import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { VisualVehicle } from './VisualVehicle.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()

        this.setGround()
        this.setTestBlocks()
        this.setBenches()
        this.setFences()
        this.setNamedShapes()
        this.setVehicle()
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

    // The first REAL models: Bruno's benches (benches.glb). Each one is a node named
    // "benchPhysicalDynamic" with two "cuboid" children. Objects.getFromModel reads
    // those NAMES and builds the colliders, so there are no collision numbers here.
    // His 7 benches are scattered over his world; we put them where WE want.
    setBenches()
    {
        const model = this.game.resources.benchesModel.scene
        const benches = model.children.filter((child) => child.name.startsWith('benchPhysical'))

        // x, z, and which way each one faces (radians)
        const placements = [
            [ -4, 6, 0 ], [ 4, 6, Math.PI * 0.5 ], [ -14, 6, Math.PI * 0.25 ], [ -8, -2, 0.3 ],
            [ 10, -2, 2 ], [ -2, -8, 1 ], [ 16, -6, 4 ],
        ]

        this.benches = []

        benches.forEach((bench, i) =>
        {
            const [ x, z, yaw ] = placements[i]

            this.benches.push(this.game.objects.addFromModel(
                bench,
                {},
                {
                    position: new THREE.Vector3(x, bench.position.y, z),
                    rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
                    friction: 0.7,
                    mass: 0.1, // Light: the car pushes them easily
                    sleeping: true // At rest until something touches them
                }
            ))
        })
    }

    // Bruno's 16 fence pieces (fences.glb, Draco-compressed), set up as a two-row pen
    // right in the car's path. Same names convention as the benches.
    setFences()
    {
        const model = this.game.resources.fencesModel.scene
        const fences = model.children.filter((child) => child.name.startsWith('fencePhysical'))

        this.fences = []

        fences.forEach((fence, i) =>
        {
            const row = Math.floor(i / 8)
            const column = i % 8

            this.fences.push(this.game.objects.addFromModel(
                fence,
                {},
                {
                    position: new THREE.Vector3(24 + row * 3, fence.position.y, 3 + column * 2.4),
                    rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.5), // Long side along Z
                    friction: 0.7,
                    mass: 0.1,
                    sleeping: true
                }
            ))
        })
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

    // The visible ground (a painted plane) AND the invisible physical ground.
    // They are separate things that happen to sit in the same place.
    setGround()
    {
        // Visual: swatch 9 (soft green)
        const geometry = this.game.materials.paint(new THREE.PlaneGeometry(200, 200), 9)
        geometry.rotateX(- Math.PI * 0.5) // Planes stand up by default, lay it flat

        this.ground = new THREE.Mesh(geometry, this.game.materials.palette)
        this.game.scene.add(this.ground)

        // Physical: a thick slab whose TOP face is at y = 0. No mesh, so `visual` is null.
        this.game.objects.add(
            null,
            {
                type: 'fixed',
                position: { x: 0, y: - 1, z: 0 },
                colliders: [ { shape: 'cuboid', parameters: [ 100, 1, 100 ] } ]
            }
        )
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
