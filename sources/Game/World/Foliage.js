import * as THREE from 'three/webgpu'
import { uniform, mix, uv, texture, vec2, rotateUV, sin, time, positionLocal, normalWorld, screenUV, screenSize, smoothstep } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Game } from '../Game.js'
import { createRandom } from '../utilities/random.js'

// Adapted from Bruno Simon's folio-2025 Foliage.js (MIT), see LICENSE-THIRD-PARTY.
// Left out for now: the received-shadow tricks and the noise-texture wind
// (replaced by a simple sine wobble).
//
// A cluster of leaves is NOT modelled leaf by leaf. It is 80 flat square cards
// scattered inside a ball. Each card is cut into a leaf shape by a texture
// (static/foliage/foliageSDF.png): bright pixels are kept, dark ones are thrown
// away ("alpha test"). The card's normals are bent so the whole ball is lit like
// a sphere, not like 80 flat sheets. Then ALL clusters (every tree, every bush)
// are drawn at once with instancing.
const random = createRandom(2024)

export class Foliage
{
    // references: objects with a position and a scale (scale.x = size of the cluster)
    // seeThrough: leaves dissolve around the car on the SCREEN, so a tree can never hide it
    constructor(references, colorA, colorB, seeThrough = false)
    {
        this.game = Game.getInstance()

        this.references = references
        this.seeThrough = seeThrough
        this.colorA = uniform(new THREE.Color(colorA)) // Side facing away from the sun
        this.colorB = uniform(new THREE.Color(colorB)) // Side facing the sun

        this.setGeometry()
        this.setMaterial()
        this.setInstancedMesh()

        // Priority 10: after the car's screen position is known (VisualVehicle, 8)
        if(this.seeThrough)
        {
            this.game.ticker.events.on('tick', () =>
            {
                this.update()
            }, 10)
        }
    }

    setGeometry()
    {
        const count = 80
        const planes = []

        for(let i = 0; i < count; i++)
        {
            const plane = new THREE.PlaneGeometry(0.8, 0.8)

            // A random place inside the ball (more cards near the surface than the centre)
            const spherical = new THREE.Spherical(
                1 - Math.pow(random(), 3),
                Math.PI * 2 * random(),
                Math.PI * random()
            )
            const position = new THREE.Vector3().setFromSpherical(spherical)

            plane.rotateZ(random() * 9999) // Random spin, so the leaf shapes do not line up
            plane.translate(position.x, position.y, position.z)

            // Normals: 85% pointing away from the ball's centre, 15% the card's own.
            const normal = position.clone().normalize()
            const normalArray = new Float32Array(12) // 4 corners x 3
            for(let corner = 0; corner < 4; corner++)
            {
                const i3 = corner * 3

                const cornerPosition = new THREE.Vector3(
                    plane.attributes.position.array[i3],
                    plane.attributes.position.array[i3 + 1],
                    plane.attributes.position.array[i3 + 2]
                )

                const mixedNormal = cornerPosition.lerp(normal, 0.85)

                normalArray[i3] = mixedNormal.x
                normalArray[i3 + 1] = mixedNormal.y
                normalArray[i3 + 2] = mixedNormal.z
            }

            plane.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3))

            planes.push(plane)
        }

        // One geometry made of all 80 cards
        this.geometry = mergeGeometries(planes)
    }

    setMaterial()
    {
        // Leaf shape: read the texture, but WOBBLE the lookup a little over time.
        // The leaf edges shimmer, which reads as wind in the leaves. (Bruno rotates it by a noise texture.)
        const wobble = sin(time.mul(0.9).add(positionLocal.x.mul(3)).add(positionLocal.z.mul(3))).mul(0.12)
        const leafAlpha = texture(this.game.resources.foliageTexture, rotateUV(uv(), wobble, vec2(0.5))).r

        // Colour: blend the two colours by how much the leaf faces the sun
        const sunFacing = normalWorld.dot(this.game.lighting.directionUniform).smoothstep(0, 1)

        // SEE-THROUGH. The leaf shape is "keep the pixels where the texture is above 0.4".
        // Near the car on screen we multiply the texture by a number that drops to 0.3, so
        // NOTHING can reach 0.4 any more: the leaves vanish. Further out the number rises back
        // to 1 smoothly, so the leaves shrink away gradually instead of switching off.
        let opacity = leafAlpha

        if(this.seeThrough)
        {
            this.seeThroughPosition = uniform(new THREE.Vector2(0.5, 0.5)) // The car, in screen coordinates (0 to 1)
            this.seeThroughEdgeMin = uniform(0.1) // Inside this distance: completely see-through
            this.seeThroughEdgeMax = uniform(0.5) // Beyond this distance: normal leaves

            // Distance on screen from this pixel to the car. Corrected for the screen's
            // shape, otherwise the hole would be an oval on a wide window.
            const toVehicle = screenUV.sub(this.seeThroughPosition).mul(vec2(screenSize.x.div(screenSize.y), 1))
            const distanceFade = smoothstep(this.seeThroughEdgeMin, this.seeThroughEdgeMax, toVehicle.length())

            opacity = leafAlpha.mul(distanceFade.mul(0.7).add(0.3))
        }

        this.material = new THREE.MeshLambertNodeMaterial()
        this.material.side = THREE.DoubleSide
        this.material.colorNode = mix(this.colorA, this.colorB, sunFacing)
        this.material.opacityNode = opacity
        this.material.alphaTest = 0.4 // Pixels darker than this are discarded: that is what cuts the leaf shape

        // The SHADOW of a leaf card must be leaf-shaped too, not a square. This tells the
        // shadow pass which pixels to keep (the same cut as above, without the wobble).
        this.material.maskShadowNode = texture(this.game.resources.foliageTexture, uv()).r.greaterThan(0.4)
    }

    setInstancedMesh()
    {
        // Every cluster faces the camera. The camera angle never changes, so this is done once.
        const towardCamera = this.game.view.spherical.offset.clone().normalize()

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.references.length)
        this.mesh.frustumCulled = false

        // Leaves throw shadows. They do not RECEIVE them: each card would shadow its neighbours
        // in the same cluster and the leaves would look speckled. (Bruno offsets the lookup to avoid this.)
        this.mesh.castShadow = true
        this.mesh.receiveShadow = false

        this.references.forEach((reference, i) =>
        {
            // A NEW helper every time. lookAt() aims from the object's CURRENT position, so
            // reusing one helper would aim each cluster from the previous cluster's place:
            // they would face the wrong way and be seen edge-on, as thin streaks.
            const object = new THREE.Object3D()

            // Random roll around the viewing direction, so clusters differ from one another
            const angle = Math.PI * 2 * random()
            object.up.set(Math.sin(angle), Math.cos(angle), 0)
            object.lookAt(towardCamera)

            object.position.copy(reference.position)
            object.scale.setScalar(reference.scale.x)
            object.updateMatrix()

            this.mesh.setMatrixAt(i, object.matrix)
        })

        this.mesh.instanceMatrix.needsUpdate = true
        this.game.scene.add(this.mesh)
    }

    update()
    {
        const screenPosition = this.game.world.visualVehicle.screenPosition

        this.seeThroughPosition.value.copy(screenPosition)

        // The hole keeps the same size on screen when you zoom: distances scale with the camera distance
        const radius = this.game.view.spherical.radius.current
        this.seeThroughEdgeMin.value = 3 / radius
        this.seeThroughEdgeMax.value = 15 / radius
    }
}
