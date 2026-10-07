import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { attribute, color, cross, dot, float, Fn, mat3, mix, modelViewMatrix, positionGeometry, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'

// Adapted from Bruno Simon's folio-2025 Trails.js (MIT), see LICENSE-THIRD-PARTY.
// His trail colours come from a gradient image; ours are two colours mixed in the shader.
//
// A TRAIL is a glowing ribbon that follows a point (the boost trails behind the car).
//
// How it works, in plain words:
//  1. Every frame we remember where the point is, in a short list of 32 positions (the "memory").
//     A new position is only added once the point has moved 0.4 units, so the list covers a fixed distance.
//  2. The memory lives in a tiny image (a DataTexture): one pixel per position, red/green/blue = x/y/z,
//     alpha = how visible that part is. It fades a little every frame.
//  3. The ribbon is a long thin tube. The GPU (vertex shader) bends it: every point along the tube
//     reads its position from the memory image and turns to face the next one.
// So the tube is not "moved" on the CPU: only the small image is rewritten each frame.

// A rotation that turns direction u into direction v (a matrix built from an axis and an angle)
const getRotationMatrix = Fn(([ u, v ]) =>
{
    const cosTheta = dot(u, v)
    const axis = cross(u, v)
    const sinTheta = axis.length()

    axis.assign(axis.normalize())

    const c = cosTheta
    const s = sinTheta
    const t = c.oneMinus()

    return mat3(
        t.mul(axis.x).mul(axis.x).add(c), t.mul(axis.x).mul(axis.y).sub(s.mul(axis.z)), t.mul(axis.x).mul(axis.z).add(s.mul(axis.y)),
        t.mul(axis.x).mul(axis.y).add(s.mul(axis.z)), t.mul(axis.y).mul(axis.y).add(c), t.mul(axis.y).mul(axis.z).sub(s.mul(axis.x)),
        t.mul(axis.x).mul(axis.z).sub(s.mul(axis.y)), t.mul(axis.y).mul(axis.z).add(s.mul(axis.x)), t.mul(axis.z).mul(axis.z).add(c)
    )
})

export class Trails
{
    constructor()
    {
        this.game = Game.getInstance()

        this.subdivisions = 32 // How many positions the memory holds
        this.texel = 1 / this.subdivisions
        this.distanceThrottle = 0.4 // A new position is saved every 0.4 units travelled
        this.emissiveMultiplier = uniform(5) // Above 1 = brighter than white: it glows
        this.fresnelOffset = uniform(0.25)
        this.decay = 0.2 // How fast the ribbon fades, per game second
        this.colorA = uniform(color('#ffb347')) // Near the car
        this.colorB = uniform(color('#ff2eb4')) // Far behind
        this.items = []

        this.setGeometry()

        // Priority 10: after the car and its parts have moved
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setGeometry()
    {
        // A thin square tube along z, cut into 32 slices, open at both ends
        this.geometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 4, this.subdivisions, true)
        this.geometry.rotateY(Math.PI * 0.25)
        this.geometry.rotateX(- Math.PI * 0.5)
        this.geometry.translate(0, 0, 0.5)

        this.geometry.deleteAttribute('uv')
    }

    // Make one trail. Set `item.position` (where it starts) and `item.alpha` (0 to 1) every frame.
    create()
    {
        const item = {}
        item.lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity)
        item.position = new THREE.Vector3()
        item.alpha = 0

        // The memory image
        item.dataTexture = new THREE.DataTexture(
            new Float32Array(this.subdivisions * 4),
            this.subdivisions,
            1,
            THREE.RGBAFormat,
            THREE.FloatType
        )

        const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
        const customNormal = vec3().toVarying()
        const ratio = float(0).toVarying()
        const alpha = float(0).toVarying()

        // Where each point of the tube goes: read its slice of the memory, turn to face the next slice
        material.positionNode = Fn(() =>
        {
            ratio.assign(positionGeometry.z.oneMinus())

            const trailData = texture(item.dataTexture, vec2(ratio, 0.5))
            const trailPosition = trailData.xyz

            const nextPosition = texture(item.dataTexture, vec2(ratio.add(this.texel), 0.5)).xyz
            const direction = nextPosition.sub(trailPosition).normalize()

            const rotationMatrix = getRotationMatrix(direction, vec3(0, 0, - 1))

            const basePosition = vec3(positionGeometry.x, positionGeometry.y, 0)
            const rotatedPoint = rotationMatrix.mul(basePosition)

            customNormal.assign(modelViewMatrix.mul(vec4(rotationMatrix.mul(attribute('normal')), 0)))

            alpha.assign(trailData.w)

            return trailPosition.add(rotatedPoint)
        })()

        // Colour: brighter in the middle of the ribbon (fresnel), orange near the car, pink far behind
        material.outputNode = Fn(() =>
        {
            const fresnel = customNormal.dot(vec3(0, 0, 1)).abs().oneMinus()
            const along = ratio.oneMinus().sub(fresnel.oneMinus().mul(this.fresnelOffset)).clamp(0, 1)
            const baseColor = mix(this.colorA, this.colorB, along).mul(this.emissiveMultiplier)

            return vec4(vec3(baseColor), ratio.oneMinus().mul(alpha))
        })()

        item.mesh = new THREE.Mesh(this.geometry, material)
        item.mesh.renderOrder = 1
        item.mesh.frustumCulled = false // Its real shape is made on the GPU, so its bounds mean nothing
        this.game.scene.add(item.mesh)

        this.items.push(item)

        return item
    }

    update()
    {
        for(const item of this.items)
        {
            const data = item.dataTexture.source.data.data

            // Moved far enough? Shift the memory by one slot
            const distance = item.lastPosition.distanceTo(item.position)

            if(distance > this.distanceThrottle)
            {
                for(let i = this.subdivisions - 1; i >= 1; i--)
                {
                    const i4 = i * 4
                    data[i4    ] = data[i4 - 4]
                    data[i4 + 1] = data[i4 - 3]
                    data[i4 + 2] = data[i4 - 2]
                    data[i4 + 3] = data[i4 - 1]
                }

                item.lastPosition.copy(item.position)
            }

            // Fade everything a little
            for(let i = this.subdivisions - 1; i >= 0; i--)
            {
                const i4 = i * 4
                data[i4 + 3] = Math.max(data[i4 + 3] - this.game.ticker.deltaScaled * this.decay, 0)
            }

            // The newest slot follows the point
            data[0] = item.position.x
            data[1] = item.position.y
            data[2] = item.position.z
            data[3] = item.alpha

            item.dataTexture.needsUpdate = true
        }
    }
}
