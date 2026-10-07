import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

// Adapted from Bruno Simon's folio-2025 PhysicsVehicle.js (MIT), see LICENSE-THIRD-PARTY.
// The numbers are his. Left out for now: boost, the three suspension heights
// (jump / low-ride), ice, the bumper collider and its collision group, and the
// flip / stuck / upside-down detectors.
//
// A "raycast vehicle". The car is ONE box (the chassis). Each wheel is a ray
// fired downward from a corner of the box. Where the ray hits the ground, a
// spring pushes the chassis up, and the wheel's grip pushes it forward or
// sideways. Rapier does the maths; we only set the numbers and feed it
// engine force, steering and brake every frame.
//
// This class is PHYSICS ONLY: no meshes. The car you SEE is a separate class
// (VisualVehicle, step 7c) that copies what happens here.
export class PhysicsVehicle
{
    constructor()
    {
        this.game = Game.getInstance()

        // Driving feel
        this.steeringAmplitude = 0.5 // Max wheel angle in radians (about 29 degrees)
        this.engineForceAmplitude = 300
        this.topSpeed = 5 // Above this the engine fades out
        this.brakeAmplitude = 35
        this.idleBrake = 0.06 // Light braking when you are not pressing anything
        this.reverseBrake = 0.4 // Brake used when you press the opposite direction
        this.suspensionHeight = 0.88 // Spring rest length. Bruno's "low" setting.
        this.suspensionStiffness = 20 // Bruno's "low" setting
        this.baseDamping = 0.1 // Air resistance on dry land
        this.waterDrag = 1.1 // Extra resistance with all 4 wheels in water

        // What the car is doing, measured after each physics step
        this.position = new THREE.Vector3(0, 4, 0)
        this.quaternion = new THREE.Quaternion()
        this.velocity = new THREE.Vector3() // Distance travelled during the last frame
        this.direction = new THREE.Vector3(1, 0, 0) // Which way it is moving
        this.forward = new THREE.Vector3(1, 0, 0) // Which way the car FACES (+X)
        this.upward = new THREE.Vector3(0, 1, 0)
        this.sideward = new THREE.Vector3(0, 0, 1)
        this.speed = 0
        this.xzSpeed = 0
        this.forwardRatio = 0 // 1 = moving the way it faces, -1 = backwards
        this.goingForward = true
        this.forwardSpeed = 0
        this.steer = 0 // Current wheel angle, so the visual can copy it
        this.waterRatio = 0 // 0 = all wheels dry, 1 = all four wheels in water

        this.setChassis()
        this.controller = this.game.physics.world.createVehicleController(this.chassis.physical.body)
        this.setWheels()

        // Priority 2: after the Player read the keys (1), before the physics step (3)
        this.game.ticker.events.on('tick', () =>
        {
            this.updatePrePhysics()
        }, 2)

        // Priority 5: after the step (3) and the mesh copy (4)
        this.game.ticker.events.on('tick', () =>
        {
            this.updatePostPhysics()
        }, 5)
    }

    setChassis()
    {
        this.chassis = {}

        const object = this.game.objects.add(null, {
            type: 'dynamic',
            position: this.position,
            friction: 0.4,
            canSleep: false,
            colliders: [
                // Main body. The weight sits LOW (centerOfMass y = -0.5), like a heavy
                // floor pan: that is what keeps the car from rolling over in corners.
                { shape: 'cuboid', mass: 2.5, parameters: [ 1.3, 0.4, 0.85 ], position: { x: 0, y: - 0.1, z: 0 }, centerOfMass: { x: 0, y: - 0.5, z: 0 } },

                // Cabin. mass 0: adds a shape for collisions but no extra weight.
                { shape: 'cuboid', mass: 0, parameters: [ 0.5, 0.15, 0.65 ], position: { x: 0, y: 0.4, z: 0 } },
            ]
        })

        this.chassis.physical = object.physical
    }

    setWheels()
    {
        this.wheels = {}
        this.wheels.inContactCount = 0
        this.wheels.items = []

        // Rapier numbers the wheels in the order we add them.
        // 0 and 1 are at the FRONT (+X), 2 and 3 at the back. Only 0 and 1 steer.
        for(let i = 0; i < 4; i++)
        {
            const wheel = {}
            wheel.inContact = false
            wheel.contactPoint = null
            wheel.suspensionLength = this.suspensionHeight // How compressed its spring is
            wheel.basePosition = new THREE.Vector3() // Where it is attached, in the chassis' own space

            // Placeholder values: updateWheelSettings() below sets the real ones
            this.controller.addWheel(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), 1, 1)

            this.wheels.items.push(wheel)
        }

        this.wheels.settings = {
            offset: { x: 0.90, y: 0, z: 0.75 }, // Wheel attachment points: +/- x (front/back), +/- z (sides)
            radius: 0.4,
            directionCs: { x: 0, y: - 1, z: 0 }, // The ray points straight down (Cs = in the chassis' space)
            axleCs: { x: 0, y: 0, z: 1 }, // The wheel spins around the Z axis
            frictionSlip: 0.9, // Grip: higher = more
            maxSuspensionForce: 150,
            maxSuspensionTravel: 2,
            sideFrictionStiffness: 3, // Resistance to sliding sideways
            suspensionCompression: 10, // Damping when the spring is pushed in
            suspensionRelaxation: 2.7, // Damping when the spring springs back
        }

        this.updateWheelSettings()
    }

    updateWheelSettings()
    {
        const settings = this.wheels.settings

        const positions = [
            new THREE.Vector3(  settings.offset.x, settings.offset.y,   settings.offset.z),
            new THREE.Vector3(  settings.offset.x, settings.offset.y, - settings.offset.z),
            new THREE.Vector3(- settings.offset.x, settings.offset.y,   settings.offset.z),
            new THREE.Vector3(- settings.offset.x, settings.offset.y, - settings.offset.z),
        ]

        for(let i = 0; i < 4; i++)
        {
            this.wheels.items[i].basePosition.copy(positions[i])

            this.controller.setWheelDirectionCs(i, settings.directionCs)
            this.controller.setWheelAxleCs(i, settings.axleCs)
            this.controller.setWheelRadius(i, settings.radius)
            this.controller.setWheelChassisConnectionPointCs(i, positions[i])
            this.controller.setWheelFrictionSlip(i, settings.frictionSlip)
            this.controller.setWheelMaxSuspensionForce(i, settings.maxSuspensionForce)
            this.controller.setWheelMaxSuspensionTravel(i, settings.maxSuspensionTravel)
            this.controller.setWheelSideFrictionStiffness(i, settings.sideFrictionStiffness)
            this.controller.setWheelSuspensionCompression(i, settings.suspensionCompression)
            this.controller.setWheelSuspensionRelaxation(i, settings.suspensionRelaxation)
            this.controller.setWheelSuspensionRestLength(i, this.suspensionHeight)
            this.controller.setWheelSuspensionStiffness(i, this.suspensionStiffness)
        }
    }

    // Teleport the car (used to respawn)
    moveTo(position, rotation = 0)
    {
        const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation)

        this.chassis.physical.body.setTranslation(position, true)
        this.chassis.physical.body.setRotation(quaternion, true)
        this.chassis.physical.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        this.chassis.physical.body.setAngvel({ x: 0, y: 0, z: 0 }, true)

        this.position.copy(position)
    }

    updatePrePhysics()
    {
        const player = this.game.player
        const deltaScaled = this.game.ticker.deltaScaled

        // FRAME RATE FIX. Rapier turns the ENGINE force into a push of
        // (force x the controller's time step). That step is capped at 1/60 s, but on a
        // faster screen it gets SMALLER (1/144 s at 144 fps), so the same force pushed
        // 2.4x less and the car was weaker. Bruno's numbers were tuned at 60 fps, so we scale the
        // force back up by the same ratio: the car now feels the same at any frame rate.
        // (The limit of 1/480 only stops a freak tiny value from making a giant force.)
        const controllerDelta = Math.max(Math.min(1 / 60, this.game.ticker.deltaAverage), 1 / 480)
        const forceScale = (1 / 60) / controllerDelta

        // Engine force: pushes all 4 wheels. Beyond topSpeed it fades toward zero,
        // so the car cannot accelerate forever.
        const overflowSpeed = Math.max(0, this.speed - this.topSpeed)
        let engineForce = player.accelerating * this.engineForceAmplitude / (1 + overflowSpeed) * deltaScaled * forceScale

        // Brake: the brake key, or a light idle brake when you press nothing
        let brake = player.braking

        if(!player.braking && Math.abs(player.accelerating) < 0.1)
            brake = this.idleBrake

        // Pressing the OPPOSITE direction while moving: brake first, do not fight the engine
        if(
            this.speed > 0.5 &&
            (
                (player.accelerating > 0 && !this.goingForward) ||
                (player.accelerating < 0 && this.goingForward)
            )
        )
        {
            brake = this.reverseBrake
            engineForce = 0
        }

        // No forceScale here: Rapier uses the brake value as it is, it is not multiplied by the controller's
        // time step like the engine force is. (Scaling it too made the car brake far too hard at high frame rates.)
        brake *= this.brakeAmplitude * deltaScaled

        // Steering: only the front wheels
        this.steer = player.steering * this.steeringAmplitude
        this.controller.setWheelSteering(0, this.steer)
        this.controller.setWheelSteering(1, this.steer)

        for(let i = 0; i < 4; i++)
        {
            this.controller.setWheelBrake(i, brake)
            this.controller.setWheelEngineForce(i, engineForce)
        }

        // Rapier integrates the wheel springs itself, with this time step. Bruno
        // caps it at 1/60 and uses the 30-frame average so one slow frame cannot
        // make the springs explode.
        this.controller.updateVehicle(controllerDelta)

        // Wading: water slows the car. The more wheels are in it, the more drag.
        this.chassis.physical.body.setLinearDamping(this.baseDamping + this.waterRatio * this.waterDrag)
    }

    updatePostPhysics()
    {
        // Where is the car now, and how far did it move this frame?
        const newPosition = new THREE.Vector3().copy(this.chassis.physical.body.translation())
        this.velocity = newPosition.clone().sub(this.position)
        this.direction = this.velocity.clone().normalize()
        this.position.copy(newPosition)
        this.quaternion.copy(this.chassis.physical.body.rotation())

        // The car's own three axes, in world space
        this.sideward.set(0, 0, 1).applyQuaternion(this.quaternion)
        this.upward.set(0, 1, 0).applyQuaternion(this.quaternion)
        this.forward.set(1, 0, 0).applyQuaternion(this.quaternion)

        // Speed in world units per game-second
        this.speed = this.velocity.length() / this.game.ticker.deltaScaled
        this.xzSpeed = Math.hypot(this.velocity.x, this.velocity.z) / this.game.ticker.deltaScaled

        // Is it going the way it faces, or sliding or reversing?
        this.forwardRatio = this.direction.dot(this.forward)
        this.goingForward = this.forwardRatio > 0.5
        this.forwardSpeed = this.speed * this.forwardRatio

        // Each wheel: touching the ground? how compressed is its spring?
        let inContactCount = 0

        for(let i = 0; i < 4; i++)
        {
            const wheel = this.wheels.items[i]

            wheel.inContact = this.controller.wheelIsInContact(i)
            wheel.contactPoint = this.controller.wheelContactPoint(i)
            wheel.suspensionLength = this.controller.wheelSuspensionLength(i)

            if(wheel.inContact)
                inContactCount++
        }

        this.wheels.inContactCount = inContactCount

        // How many wheels are touching ground that is UNDER the water surface?
        const surface = this.game.water.surfaceElevation
        let inWater = 0

        for(const wheel of this.wheels.items)
        {
            if(wheel.inContact && wheel.contactPoint && wheel.contactPoint.y < surface)
                inWater++
        }

        this.waterRatio = inWater / 4
    }
}
