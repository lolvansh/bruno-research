import { uniform } from 'three/tsl'
import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Water.js (MIT), see LICENSE-THIRD-PARTY.
// Just the two numbers everything about water agrees on, as plain values AND as shader values.
//
//   y =  0     the land (flat)
//   y = -0.3   the WATER SURFACE: anything lower than this is under water
//   y = -1.5   the deepest sea floor (see Terrain.depthScale)
export class Water
{
    constructor()
    {
        this.game = Game.getInstance()

        this.surfaceElevation = - 0.3
        this.depthElevation = - 1.5

        // The same numbers, for shaders
        this.surfaceElevationUniform = uniform(this.surfaceElevation)
        this.surfaceThicknessUniform = uniform(0.04) // How thick the white waterline on objects is
    }
}
