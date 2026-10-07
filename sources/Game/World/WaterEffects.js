import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

// OURS (not Bruno's): what the water does when the car goes through it.
//
//   SPLASH:   when a wheel hits the water fast, droplets fly up and fall back down.
//             Each droplet that lands makes a small ripple.
//   WAKE:     while a wheel is in the water and moving, it leaves ripple rings behind it
//             that spread out and fade.
//
// Both are POOLS: a fixed number of reusable objects (48 rings, 160 droplets) created once.
// Making and destroying objects every time something splashes would stutter; reusing the
// same ones does not. Each frame we move the active ones and hide the rest.
export class WaterEffects
{
    constructor()
    {
        this.game = Game.getInstance()

        this.surface = this.game.water.surfaceElevation

        this.hidden = new THREE.Matrix4().makeScale(0, 0, 0) // A matrix that shrinks something to nothing
        this.black = new THREE.Color(0, 0, 0)
        this.dummy = new THREE.Object3D() // A helper to build matrices from position and scale

        this.setRings()
        this.setDroplets()

        // For each wheel: was it in the water last frame? how far has it travelled since its last ripple?
        this.wheels = [ 0, 1, 2, 3 ].map(() => ({ inWater: false, distance: 0 }))

        // Priority 10: after the car moved (5)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    /**
     * Ripples: flat rings that grow and fade
     */
    setRings()
    {
        const count = 48

        // A flat ring: 88% to 100% of its radius
        const geometry = new THREE.RingGeometry(0.88, 1, 40)
        geometry.rotateX(- Math.PI * 0.5)

        // Additive blending ADDS its colour to what is behind. So "fading out" = making the
        // colour darker, and black is invisible. That is how each ring fades on its own.
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })

        this.rings = {}
        this.rings.next = 0
        this.rings.items = []
        this.rings.mesh = new THREE.InstancedMesh(geometry, material, count)
        this.rings.mesh.frustumCulled = false
        this.rings.mesh.renderOrder = 2

        for(let i = 0; i < count; i++)
        {
            this.rings.items.push({ active: false, age: 0, life: 1, x: 0, z: 0, size: 1 })
            this.rings.mesh.setMatrixAt(i, this.hidden)
            this.rings.mesh.setColorAt(i, this.black)
        }

        this.game.scene.add(this.rings.mesh)
    }

    spawnRing(x, z, size = 2, life = 1.1)
    {
        const ring = this.rings.items[this.rings.next]
        this.rings.next = (this.rings.next + 1) % this.rings.items.length // Reuse the oldest

        ring.active = true
        ring.age = 0
        ring.life = life
        ring.x = x
        ring.z = z
        ring.size = size
    }

    updateRings(dt)
    {
        const mesh = this.rings.mesh
        const white = new THREE.Color()

        this.rings.items.forEach((ring, i) =>
        {
            if(!ring.active)
                return

            ring.age += dt / ring.life

            // Finished: hide it, and it is free for reuse
            if(ring.age >= 1)
            {
                ring.active = false
                mesh.setMatrixAt(i, this.hidden)
                mesh.setColorAt(i, this.black)
                return
            }

            // Grows fast at first, then slows down: 1 - (1 - age)^2
            const grow = 1 - Math.pow(1 - ring.age, 2)

            this.dummy.position.set(ring.x, this.surface + 0.03, ring.z)
            this.dummy.scale.setScalar(0.15 + ring.size * grow)
            this.dummy.updateMatrix()
            mesh.setMatrixAt(i, this.dummy.matrix)

            // Fade: full brightness at birth, black at the end
            mesh.setColorAt(i, white.setScalar((1 - ring.age) * 0.6))
        })

        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
    }

    /**
     * Droplets: small white blobs thrown up, pulled back down by gravity
     */
    setDroplets()
    {
        const count = 160

        const geometry = new THREE.SphereGeometry(0.5, 6, 4)
        const material = new THREE.MeshBasicNodeMaterial() // Unlit white

        this.droplets = {}
        this.droplets.next = 0
        this.droplets.items = []
        this.droplets.mesh = new THREE.InstancedMesh(geometry, material, count)
        this.droplets.mesh.frustumCulled = false

        for(let i = 0; i < count; i++)
        {
            this.droplets.items.push({ active: false, age: 0, life: 1, size: 0.1, position: new THREE.Vector3(), velocity: new THREE.Vector3() })
            this.droplets.mesh.setMatrixAt(i, this.hidden)
        }

        this.game.scene.add(this.droplets.mesh)
    }

    // A burst of droplets from one point. `strength` 0..1.2 (how fast the car was going);
    // `direction` is where the car is heading, so the spray is thrown partly that way.
    splash(x, z, strength, direction)
    {
        const count = Math.round(10 + 22 * strength)

        for(let i = 0; i < count; i++)
        {
            const droplet = this.droplets.items[this.droplets.next]
            this.droplets.next = (this.droplets.next + 1) % this.droplets.items.length

            const angle = Math.random() * Math.PI * 2
            const sideways = (1 + Math.random() * 2.5) * strength

            droplet.active = true
            droplet.age = 0
            droplet.life = 0.8 + Math.random() * 0.6
            droplet.size = 0.09 + Math.random() * 0.11
            droplet.position.set(x, this.surface, z)
            droplet.velocity.set(
                Math.cos(angle) * sideways + direction.x * strength * 2,
                (2.5 + Math.random() * 3) * Math.max(strength, 0.4), // Up
                Math.sin(angle) * sideways + direction.z * strength * 2
            )
        }
    }

    updateDroplets(dt)
    {
        const mesh = this.droplets.mesh

        this.droplets.items.forEach((droplet, i) =>
        {
            if(!droplet.active)
                return

            droplet.age += dt / droplet.life
            droplet.velocity.y -= 9.81 * dt // Gravity, the same as the physics world
            droplet.position.addScaledVector(droplet.velocity, dt)

            // Back to the water: the droplet ends, and sometimes leaves a tiny ripple where it lands
            const landed = droplet.position.y < this.surface && droplet.velocity.y < 0

            if(droplet.age >= 1 || landed)
            {
                droplet.active = false
                mesh.setMatrixAt(i, this.hidden)

                if(landed && Math.random() < 0.3)
                    this.spawnRing(droplet.position.x, droplet.position.z, 0.7, 0.7)

                return
            }

            // Shrinks as it gets old
            this.dummy.position.copy(droplet.position)
            this.dummy.scale.setScalar(droplet.size * (1 - droplet.age * droplet.age))
            this.dummy.updateMatrix()
            mesh.setMatrixAt(i, this.dummy.matrix)
        })

        mesh.instanceMatrix.needsUpdate = true
    }

    update()
    {
        const vehicle = this.game.physicalVehicle
        const dt = this.game.ticker.deltaScaled // The game clock, like the physics

        vehicle.wheels.items.forEach((wheel, i) =>
        {
            const state = this.wheels[i]

            // In the water = touching the ground, and the ground is under the surface
            const inWater = wheel.inContact && !!wheel.contactPoint && wheel.contactPoint.y < this.surface - 0.02

            if(inWater)
            {
                // Just got in, and fast enough to make a splash
                if(!state.inWater && vehicle.speed > 1.5)
                    this.splash(wheel.contactPoint.x, wheel.contactPoint.z, Math.min(1.2, vehicle.speed / 6), vehicle.direction)

                // A ripple every 1.4 units travelled
                state.distance += vehicle.xzSpeed * dt

                if(state.distance > 1.4 && vehicle.xzSpeed > 0.5)
                {
                    state.distance = 0
                    this.spawnRing(wheel.contactPoint.x, wheel.contactPoint.z, 1.4 + vehicle.xzSpeed * 0.12, 1.1)
                }
            }
            else
            {
                state.distance = 0
            }

            state.inWater = inWater
        })

        this.updateRings(dt)
        this.updateDroplets(dt)
    }
}
