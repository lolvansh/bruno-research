import * as THREE from 'three/webgpu'
import { color, mix, uv, vec2, vec3, vec4, luminance, positionWorld, smoothstep, float, uniform, step, screenUV, screenSize, cameraPosition } from 'three/tsl'
import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Materials.js (MIT), see LICENSE-THIRD-PARTY.
// His versions build big custom shaders (shadows, fog, light bounce, reveal...).
// Ours are the plain versions of the same ideas.
//
// THE PALETTE TRICK
// static/palette.png is a tiny image: 128 x 4 pixels. It is not a picture, it
// is a list of colours. Each colour is a 4 x 4 block of pixels ("swatch"),
// laid out left to right:
//
//    0 #7c7691   1 #ebd1a3   2 #574e37   3 #3dbbe7   4 #c8c2c1   5 #4a413c
//    6 #575a5e   7 #eec3af   8 #e4a90c   9 #91ad78  10 #e49a78  11 #988165
//   12 #abae2b  13 #a49876  14 #b36d45  15 #e56202  16 #ec3f1c  17 #fde6e1
//   18 #f8a658  19 #c30e3a  20 #c366ef  21 #ed719f  22 #1e0603  23 #fff2e8
//
// Every face of every model has UV coordinates = "which point of the image do
// I read my colour from". Point a face at swatch 16 and it is red. One image,
// one material, the whole world.
//
// MATERIALS BY NAME
// A model made in Blender carries material NAMES ("palette", "redGradient"...).
// When a model is loaded, updateObject() swaps each one for OUR material of the
// same name. That is how the car's paint, glow and palette colours all work.
export class Materials
{
    static PALETTE_WIDTH = 128
    static SWATCH_SIZE = 4

    constructor()
    {
        this.game = Game.getInstance()

        this.list = new Map()

        this.setPalette()
        this.setNamedMaterials()
        this.setSeeThrough()
    }

    // THE CUT-AWAY. The camera angle is fixed, so a tall building (or a bridge cable) can end up between
    // the camera and the car and hide it. Bruno's leaves dissolve around the car on the screen; we do the
    // same for big solid things, with one extra rule: only the parts that are CLOSER to the camera than
    // the car get a hole (a wall behind the car stays whole).
    //
    // 'paletteSeeThrough' is the normal palette material plus that hole. World.js gives it to the
    // landmarks and the bridge.
    setSeeThrough()
    {
        this.seeThrough = {
            carScreen: uniform(new THREE.Vector2(0.5, 0.5)), // The car on the screen (0 to 1)
            edgeMin: uniform(0.1),                            // Inside this screen distance: fully cut away
            edgeMax: uniform(0.5),                            // Beyond this: solid
            carDistance: uniform(20),                         // How far the car is from the camera, in world units
        }

        const { carScreen, edgeMin, edgeMax, carDistance } = this.seeThrough

        // Distance on screen from this pixel to the car (corrected for the shape of the window)
        const toCar = screenUV.sub(carScreen).mul(vec2(screenSize.x.div(screenSize.y), 1))
        const hole = float(1).sub(smoothstep(edgeMin, edgeMax, toCar.length()))

        // 1 if this pixel is clearly nearer to the camera than the car, else 0
        const inFront = step(positionWorld.sub(cameraPosition).length().add(1), carDistance)

        const material = new THREE.MeshLambertNodeMaterial({ map: this.paletteTexture })
        material.opacityNode = float(1).sub(hole.mul(inFront))
        material.alphaTest = 0.5 // Pixels with less than half opacity are thrown away: that is the hole
        material.maskShadowNode = float(1).greaterThan(0.5) // The shadow stays whole, only the picture has a hole
        this.save('paletteSeeThrough', material)

        // Priority 9: after the camera (7) and the car's screen position (8) are known
        this.game.ticker.events.on('tick', () =>
        {
            const vehicle = this.game.world?.visualVehicle
            const physicalVehicle = this.game.physicalVehicle

            if(!vehicle || !physicalVehicle)
                return

            carScreen.value.copy(vehicle.screenPosition)

            // The hole keeps its size on screen when you zoom, like the leaves do
            const radius = this.game.view.spherical.radius.current
            edgeMin.value = 3 / radius
            edgeMax.value = 8 / radius

            carDistance.value = this.game.view.camera.position.distanceTo(physicalVehicle.position)
        }, 9)
    }

    // Give a loaded model the cut-away version of our palette material
    makeSeeThrough(object)
    {
        const material = this.list.get('paletteSeeThrough')

        object.traverse((child) =>
        {
            if(child.isMesh && child.material === this.palette)
                child.material = material
        })
    }

    setPalette()
    {
        // The image itself is loaded by ResourcesLoader (see Game.init),
        // with the right filters already set.
        this.paletteTexture = this.game.resources.paletteTexture

        // Lambert = simple matte lighting. Light hits a face, it gets brighter or darker.
        // That alone gives the faceted, low-poly look.
        this.palette = new THREE.MeshLambertNodeMaterial({ map: this.paletteTexture })
        this.save('palette', this.palette)
    }

    setNamedMaterials()
    {
        // Paint: a colour that fades from top to bottom of each surface (follows the model's UV)
        // The first is what the model asks for by name. The others are alternatives
        // VisualVehicle can switch to (Bruno's own values).
        this.createGradient('redGradient', '#ff3a3a', '#721551')
        this.createGradient('orangeGradient', '#ff940d', '#af0071')
        this.createGradient('whiteGradient', '#ffffff', '#b5b5b5')
        this.createGradient('blackGradient', '#626262', '#262526')

        // Glow: bright, ignores lights. Radial = brightest at the centre of the UV square.
        this.createEmissiveGradient('emissiveOrangeRadialGradient', '#ff8641', '#ff3e00', 1.7, true)
        this.createEmissiveGradient('emissivePurpleRadialGradient', '#454bbc', '#ff2eb4', 1.7, true)
    }

    save(name, material)
    {
        material.name = name

        if(material.isMeshLambertNodeMaterial)
            this.addWaterline(material)

        this.list.set(name, material)
    }

    // THE WATERLINE. Wherever a surface crosses the water level (y = -0.3), paint a thin
    // white band. The car half under water, a bench pushed into a pond, a wall at the
    // shore: all get a white line exactly where the water touches them. Bruno does the
    // same inside his big shader. Here it is a small glow added to each lit material.
    addWaterline(material)
    {
        const water = this.game.water
        const distanceToSurface = positionWorld.y.sub(water.surfaceElevationUniform).abs()
        const band = float(1).sub(smoothstep(0, water.surfaceThicknessUniform, distanceToSurface))

        material.emissiveNode = vec3(band)
    }

    // THE SHADER LANGUAGE (TSL). Instead of writing GPU code, we describe the
    // colour as a small graph of operations: "mix colour A and B by the V coordinate".
    createGradient(name, colorA, colorB)
    {
        const material = new THREE.MeshLambertNodeMaterial()
        material.colorNode = mix(color(colorA), color(colorB), uv().y)

        this.save(name, material)

        return material
    }

    createEmissiveGradient(name, colorA, colorB, intensity = 1, normalize = true)
    {
        // Distance from the centre of the UV square: 0 in the middle, 1 at the edge
        const distanceToCenter = uv().sub(0.5).length().mul(2)
        let mixedColor = mix(color(colorA), color(colorB), distanceToCenter)

        // Divide by brightness so both colours glow equally hard
        if(normalize)
            mixedColor = mixedColor.div(luminance(mixedColor))

        // Basic = no lighting at all. Values above 1 are brighter than white.
        const material = new THREE.MeshBasicNodeMaterial()
        material.outputNode = vec4(mixedColor.mul(intensity), 1)
        material.fog = false

        this.save(name, material)

        return material
    }

    // For a name we do not know: a plain lit material with the same colour.
    createFromMaterial(baseMaterial)
    {
        const material = new THREE.MeshLambertNodeMaterial({ color: baseMaterial.color, map: baseMaterial.map })
        this.addWaterline(material)

        return material
    }

    getFromName(name, baseMaterial)
    {
        if(name !== '' && this.list.has(name))
            return this.list.get(name)

        const material = this.createFromMaterial(baseMaterial)

        // Remember it, so every object using that name shares ONE material
        if(name !== '')
            this.save(name, material)

        return material
    }

    // Swap every mesh's material (in a loaded model) for ours of the same name.
    updateObject(object)
    {
        object.traverse((child) =>
        {
            if(child.isMesh)
                child.material = this.getFromName(child.material.name, child.material)
        })
    }

    // The UV point at the middle of a swatch. The middle (not the edge) so we never
    // touch a neighbouring colour. Any row works because all 4 rows are identical.
    getPaletteUv(index)
    {
        const u = (index * Materials.SWATCH_SIZE + Materials.SWATCH_SIZE * 0.5) / Materials.PALETTE_WIDTH
        const v = 0.5

        return [ u, v ]
    }

    // For shapes we build in code: point EVERY vertex at one swatch.
    // (Models from Blender already carry UVs that point at swatches.)
    paint(geometry, index)
    {
        const [ u, v ] = this.getPaletteUv(index)
        const uvAttribute = geometry.attributes.uv

        for(let i = 0; i < uvAttribute.count; i++)
            uvAttribute.setXY(i, u, v)

        uvAttribute.needsUpdate = true

        return geometry
    }
}
