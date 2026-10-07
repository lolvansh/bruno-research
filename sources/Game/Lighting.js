import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Ligthing.js (MIT), see LICENSE-THIRD-PARTY.
// Left out for now: the day/night cycle, the "light bounce" and "core shadow" tricks
// of his custom material, and the quality levels.
//
// HOW A SHADOW IS MADE (a "shadow map"):
//   1. Before drawing the world, the GPU draws it once FROM THE SUN'S POINT OF VIEW,
//      but only remembers one thing per pixel: how far away the nearest surface is.
//      That picture is the shadow map.
//   2. When drawing the real picture, for each point the GPU asks the map:
//      "from the sun, is there something closer than me?" Yes -> I am in shadow.
//
// The map has a fixed number of pixels (2048 x 2048). Spread over the whole island the
// shadows would be blurry blocks, so the sun's view is only a SMALL SQUARE that
// FOLLOWS THE CAMERA. Everything you can see gets sharp shadows.
export class Lighting
{
    constructor()
    {
        this.game = Game.getInstance()

        // Where the sun is, as two angles (radians):
        //   phi   = how high: 0 = straight overhead, PI/2 = on the horizon
        //   theta = which compass direction
        // This one sits to the right of the screen and a bit behind the scene, so the
        // shadows fall toward the viewer's left and are easy to see.
        this.phi = 0.63
        this.theta = 2.72
        this.distance = 50 // How far the sun's camera sits from what it looks at

        this.spherical = new THREE.Spherical(this.distance, this.phi, this.theta)

        // The direction TOWARD the sun. Also given to shaders (the leaves use it).
        this.direction = new THREE.Vector3().setFromSpherical(this.spherical).normalize()
        this.directionUniform = uniform(this.direction)

        // Shadow quality settings
        this.mapSize = 2048
        this.shadowAmplitude = 36 // The shadow window is 72 x 72 units, centred on the camera focus
        this.near = 10
        this.depth = 100 // The sun's camera sees from `near` to `near + depth` units away
        this.shadowBias = - 0.001 // Pushes shadows slightly away: prevents "shadow acne" (speckles on lit surfaces)
        this.shadowNormalBias = 0.1 // The same, along the surface direction
        this.shadowRadius = 3 // Softness of the shadow edge

        this.setAmbient()
        this.setSun()

        // Priority 9: after the camera moved (7), before drawing (998)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 9)
    }

    // Light that comes from everywhere (the sky), tinted purple on top and warm below.
    // Shadows are exactly the places where ONLY this light arrives, so this tint is the
    // colour of the shadows. Bruno's shadows are purple, not grey: that is why.
    setAmbient()
    {
        this.hemisphere = new THREE.HemisphereLight('#9a8be6', '#c48f86', 1.0)
        this.game.scene.add(this.hemisphere)
    }

    // The sun: parallel rays from one direction, and the only light that makes shadows
    setSun()
    {
        this.sun = new THREE.DirectionalLight('#fff1d6', 3.2)
        this.sun.castShadow = true

        this.sun.shadow.mapSize.set(this.mapSize, this.mapSize)
        this.sun.shadow.camera.left = - this.shadowAmplitude
        this.sun.shadow.camera.right = this.shadowAmplitude
        this.sun.shadow.camera.top = this.shadowAmplitude
        this.sun.shadow.camera.bottom = - this.shadowAmplitude
        this.sun.shadow.camera.near = this.near
        this.sun.shadow.camera.far = this.near + this.depth
        this.sun.shadow.camera.updateProjectionMatrix()
        this.sun.shadow.bias = this.shadowBias
        this.sun.shadow.normalBias = this.shadowNormalBias
        this.sun.shadow.radius = this.shadowRadius

        // A directional light shines from its position TOWARD its target
        this.game.scene.add(this.sun)
        this.game.scene.add(this.sun.target)

        this.update()
    }

    update()
    {
        // Keep the shadow window centred on what the camera looks at
        const focus = this.game.view.focusPoint.smoothedPosition

        this.sun.target.position.copy(focus)
        this.sun.position.copy(this.direction).multiplyScalar(this.distance).add(focus)
    }
}
