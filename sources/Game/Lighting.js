import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import { Game } from './Game.js'

// MINIMAL lighting, enough to make shapes readable.
// Bruno's Ligthing.js is much bigger (follows the player, shadows, day cycle):
// we add those later, one at a time.
export class Lighting
{
    constructor()
    {
        this.game = Game.getInstance()

        // Soft light from the sky, tinted by the ground colour below.
        // Lights every face a little, so shadowed sides never go black.
        this.hemisphere = new THREE.HemisphereLight('#ffffff', '#9a8f7a', 1.2)
        this.game.scene.add(this.hemisphere)

        // The sun: parallel rays from one direction.
        // Faces pointing at it are bright, faces pointing away are darker.
        this.sun = new THREE.DirectionalLight('#fff1d6', 2.5)
        this.sun.position.set(10, 20, 8)
        this.game.scene.add(this.sun)

        // The same sun direction, but available inside shaders (TSL).
        // The leaves use it: the side facing the sun gets one colour, the other side the other.
        this.direction = this.sun.position.clone().normalize()
        this.directionUniform = uniform(this.direction)
    }
}
