import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

// Adapted from Bruno Simon's folio-2025 VisualVehicle.js (MIT), see LICENSE-THIRD-PARTY.
// Left out for now: ground tracks, blinkers, brake lights, antenna, boost trails
// and glow, and paint choices.
//
// The car you SEE. It has no physics of its own: every frame it copies what
// PhysicsVehicle did (position, rotation, spring lengths, steering) onto the
// model, and spins the wheels.
//
// It finds the model's parts BY NAME, so any model works if the names match:
//
//   chassis                root group (required)
//     bodyPainted          the painted shell (required)
//   wheelContainer         ONE wheel, cloned 4 times (required)
//     wheelCylinder        the spinning tyre and hub. Origin must be the axle centre.
//     wheelSuspension      the strut that stretches with the spring
//     wheelPainted         the painted hub
//
// Your own Ambassador will be loaded here, with the same names.
export class VisualVehicle
{
    constructor(model)
    {
        this.game = Game.getInstance()

        this.model = model

        this.setParts()
        this.setWheels()
        this.setPaints()

        // Where the car is ON THE SCREEN (0 to 1 in x and y, origin top-left).
        // The tree leaves read this to dissolve around the car.
        this.screenPosition = new THREE.Vector2(0.5, 0.5)

        // Priority 8: after the car moved (5) and the camera got its position (7)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 8)
    }

    setParts()
    {
        this.parts = {}

        const searchList = [
            'chassis',
            'bodyPainted',
            'wheelContainer',
            'blinkerLeft',
            'blinkerRight',
            'stopLights',
            'backLights',
        ].map((name) => new RegExp(`^(${name})`, 'i')) // Names START with it: "chassis.001" matches "chassis"

        this.model.traverse((child) =>
        {
            for(const search of searchList)
            {
                const match = child.name.match(search)

                if(match)
                    this.parts[match[0]] = child
            }
        })

        // A clear message beats "cannot read properties of undefined"
        for(const required of [ 'chassis', 'bodyPainted', 'wheelContainer' ])
        {
            if(!this.parts[required])
                throw new Error(`VisualVehicle: the car model has no object whose name starts with "${required}". Found: ${Object.keys(this.parts).join(', ') || 'nothing'}`)
        }

        // Rotate yaw first, then pitch, then roll: the natural order for a car
        this.parts.chassis.rotation.reorder('YXZ')

        // The car throws and catches shadows. (Set on every mesh of the chassis and the wheel.)
        for(const part of [ this.parts.chassis, this.parts.wheelContainer ])
        {
            part.traverse((child) =>
            {
                if(child.isMesh)
                {
                    child.castShadow = true
                    child.receiveShadow = true
                }
            })
        }

        // Swap the model's materials for ours (palette, paint...), and add it to the world
        this.game.materials.updateObject(this.parts.chassis)
        this.game.materials.updateObject(this.parts.wheelContainer)
        this.game.scene.add(this.parts.chassis)

        // Lights that only show while turning or braking: off until we add them
        for(const name of [ 'blinkerLeft', 'blinkerRight', 'stopLights', 'backLights' ])
        {
            if(this.parts[name])
                this.parts[name].visible = false
        }
    }

    setWheels()
    {
        this.wheels = {}
        this.wheels.items = []
        this.wheels.steering = 0

        for(let i = 0; i < 4; i++)
        {
            const wheel = {}

            // The model contains ONE wheel. Make four copies and hang them on the chassis.
            wheel.container = this.parts.wheelContainer.clone(true)
            this.parts.chassis.add(wheel.container)

            wheel.container.traverse((child) =>
            {
                if(child.name.match(/^wheelSuspension/))
                    wheel.suspension = child
                if(child.name.match(/^wheelCylinder/))
                    wheel.cylinder = child
                if(child.name.match(/^wheelPainted/))
                    wheel.painted = child
            })

            // The tyre must turn around its own centre
            wheel.cylinder.position.set(0, 0, 0)

            // The wheel in the model is built for ONE side of the car. On the other
            // side we turn it half a round, so the outside faces outwards.
            if(i === 0 || i === 2)
                wheel.container.rotation.y = Math.PI

            this.wheels.items.push(wheel)
        }
    }

    // The paint is just a material. Changing the car's colour means giving the
    // painted parts (the body and each wheel hub) a different material.
    // (Bruno changes it when you unlock a reward. Here: press C.)
    setPaints()
    {
        this.paints = {}
        this.paints.names = [ 'black', 'red', 'orange', 'white' ] // Materials 'blackGradient', 'redGradient'... The first one is the starting colour.
        this.paints.index = 0

        this.paints.changeTo = (name) =>
        {
            const material = this.game.materials.list.get(`${name}Gradient`)

            if(!material)
                return false

            this.parts.bodyPainted.material = material

            for(const wheel of this.wheels.items)
            {
                if(wheel.painted)
                    wheel.painted.material = material
            }

            return true
        }

        // Start with the first colour of the list (the model itself is exported with red)
        this.paints.changeTo(this.paints.names[0])

        this.game.inputs.addActions([
            { name: 'paint', categories: [ 'wandering' ], keys: [ 'Keyboard.KeyC' ] },
        ])

        this.game.inputs.events.on('paint', (action) =>
        {
            if(!action.active)
                return

            this.paints.index = (this.paints.index + 1) % this.paints.names.length
            this.paints.changeTo(this.paints.names[this.paints.index])
        })
    }

    update()
    {
        const physicalVehicle = this.game.physicalVehicle
        const deltaScaled = this.game.ticker.deltaScaled
        const actions = this.game.inputs.actions

        // Chassis: copy the physics
        this.parts.chassis.position.copy(physicalVehicle.position)
        this.parts.chassis.quaternion.copy(physicalVehicle.quaternion)

        // Steering: glide toward the wanted angle instead of snapping
        this.wheels.steering += ((this.game.player.steering * physicalVehicle.steeringAmplitude) - this.wheels.steering) * deltaScaled * 16

        // How far the tyres turn this frame. Bruno's 0.006 makes them turn much slower
        // than the real speed: at full speed the wheels would flicker like a film.
        const wheelsRotation = physicalVehicle.forwardSpeed / physicalVehicle.wheels.settings.radius * 0.006

        for(let i = 0; i < 4; i++)
        {
            const visualWheel = this.wheels.items[i]
            const physicalWheel = physicalVehicle.wheels.items[i]

            // Spin. Not while braking without pressing the pedal (a locked wheel).
            // The two sides are mirrored, so they spin opposite ways.
            if(!actions.get('brake').active || actions.get('forward').active || actions.get('backward').active)
            {
                if(i === 0 || i === 2)
                    visualWheel.cylinder.rotation.z += wheelsRotation
                else
                    visualWheel.cylinder.rotation.z -= wheelsRotation
            }

            // Steer: only the front pair (0 and 1)
            if(i === 0)
                visualWheel.container.rotation.y = Math.PI + this.wheels.steering

            if(i === 1)
                visualWheel.container.rotation.y = this.wheels.steering

            // Springs: the wheel hangs `suspensionLength` below its attachment point
            let wheelY = physicalWheel.basePosition.y - physicalWheel.suspensionLength
            wheelY = Math.min(wheelY, - 0.5)

            visualWheel.container.position.x = physicalWheel.basePosition.x
            visualWheel.container.position.y += (wheelY - visualWheel.container.position.y) * 25 * deltaScaled
            visualWheel.container.position.z = physicalWheel.basePosition.z

            // Stretch the strut so it still reaches the wheel
            if(visualWheel.suspension)
                visualWheel.suspension.scale.y = Math.abs(visualWheel.container.position.y) - 0.5
        }

        // Screen position: project the car's 3D position through the camera
        const vector = new THREE.Vector3().copy(physicalVehicle.position)
        vector.project(this.game.view.camera) // Now x and y run from -1 to 1, y UP

        this.screenPosition.x = vector.x * 0.5 + 0.5
        this.screenPosition.y = vector.y * - 0.5 + 0.5 // Flip y: screen coordinates run downward
    }
}
