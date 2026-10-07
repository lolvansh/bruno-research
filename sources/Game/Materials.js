import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

// Adapted from the idea in Bruno Simon's folio-2025 Materials.js (MIT),
// see LICENSE-THIRD-PARTY. His version builds a big custom shader material;
// ours is the plain version of the same trick.
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
export class Materials
{
    static PALETTE_WIDTH = 128
    static SWATCH_SIZE = 4

    constructor()
    {
        this.game = Game.getInstance()

        // The image itself is loaded by ResourcesLoader (see Game.init),
        // with the right filters already set.
        this.paletteTexture = this.game.resources.paletteTexture

        // Lambert = simple matte lighting. Light hits a face, it gets brighter or darker.
        // That alone gives the faceted, low-poly look.
        this.palette = new THREE.MeshLambertNodeMaterial({ map: this.paletteTexture })
    }

    // Models from Blender arrive with their own material, named "palette".
    // Swap it for ours, so the whole world shares ONE material.
    // (Bruno does the same in Materials.updateObject, by material name.)
    updateObject(object)
    {
        object.traverse((child) =>
        {
            if(child.isMesh && child.material.name === 'palette')
                child.material = this.palette
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
        const uv = geometry.attributes.uv

        for(let i = 0; i < uv.count; i++)
            uv.setXY(i, u, v)

        uv.needsUpdate = true

        return geometry
    }
}
