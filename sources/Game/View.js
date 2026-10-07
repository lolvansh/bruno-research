import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 View.js (MIT), see LICENSE-THIRD-PARTY.
// Much smaller: only the focus point, the zoom and the spherical offset.
// Like his, the viewing angle is fixed.
//
// The idea: the camera does not follow the player directly. It looks at a
// "focus point" that glides toward the player, and sits on an invisible
// sphere around that point.
export class View
{
    constructor()
    {
        this.game = Game.getInstance()

        this.position = new THREE.Vector3()

        this.setFocusPoint()
        this.setZoom()
        this.setSpherical()
        this.setCamera()
        this.setControls()

        // Priority 7: after the player has moved (6), before drawing (998)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 7)

        this.game.viewport.events.on('change', () =>
        {
            this.resize()
        })

        this.update()
    }

    setFocusPoint()
    {
        this.focusPoint = {}
        this.focusPoint.trackedPosition = new THREE.Vector3() // Where the thing we follow is. Others write here.
        this.focusPoint.smoothedPosition = new THREE.Vector3() // Where the camera really looks. Lags behind.
        this.focusPoint.easing = 10 // Higher = catches up faster
    }

    setZoom()
    {
        this.zoom = {}
        this.zoom.baseRatio = 0.6 // Where the user wants it: 0 = far, 1 = close
        this.zoom.smoothedRatio = this.zoom.baseRatio // Where it really is
        this.zoom.sensitivity = 0.05
    }

    setSpherical()
    {
        // The camera sits on a sphere around the focus point.
        // phi   = angle from straight up (0 = bird's eye view, PI/2 = at ground level)
        // theta = angle around the vertical axis (which side we look from)
        this.spherical = {}
        this.spherical.phi = Math.PI * 0.31
        this.spherical.theta = Math.PI * 0.25

        this.spherical.radius = {}
        this.spherical.radius.edges = { min: 15, max: 30 } // Closest and farthest distance
        this.spherical.radius.current = THREE.MathUtils.lerp(
            this.spherical.radius.edges.min,
            this.spherical.radius.edges.max,
            1 - this.zoom.smoothedRatio
        )

        // The offset from the focus point to the camera
        this.spherical.offset = new THREE.Vector3()
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta)
    }

    setCamera()
    {
        // 25 degrees is a narrow field of view: flatter, more "miniature diorama" look
        this.camera = new THREE.PerspectiveCamera(25, this.game.viewport.ratio, 0.1, 200)
        this.game.scene.add(this.camera)
    }

    // TEMPORARY: a raw mouse wheel listener. In step 7 it moves into a proper Inputs system.
    // The angle never changes: only the distance does.
    setControls()
    {
        const element = this.game.domElement

        element.addEventListener('wheel', (event) =>
        {
            event.preventDefault()

            // A mouse wheel notch is ~100, a trackpad sends many tiny values.
            // Scaling by the real amount keeps both feeling similar.
            // (Some browsers report lines instead of pixels: ~33 pixels per line.)
            const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY
            const notches = THREE.MathUtils.clamp(pixels / 100, -1, 1)

            // Scroll down = zoom out
            this.zoom.baseRatio -= notches * this.zoom.sensitivity
            this.zoom.baseRatio = THREE.MathUtils.clamp(this.zoom.baseRatio, 0, 1)
        }, { passive: false })
    }

    update()
    {
        const delta = this.game.ticker.delta

        // Focus point: move a fraction of the remaining distance each frame.
        // Far away = big step, close = tiny step. That is the "easing".
        this.focusPoint.smoothedPosition.lerp(
            this.focusPoint.trackedPosition,
            Math.min(1, delta * this.focusPoint.easing)
        )

        // Zoom: same trick
        this.zoom.smoothedRatio = THREE.MathUtils.lerp(this.zoom.smoothedRatio, this.zoom.baseRatio, delta * 10)

        // Distance from the focus point
        this.spherical.radius.current = THREE.MathUtils.lerp(
            this.spherical.radius.edges.min,
            this.spherical.radius.edges.max,
            1 - this.zoom.smoothedRatio
        )

        // Offset from the focus point, then the camera position
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta)
        this.position.copy(this.focusPoint.smoothedPosition).add(this.spherical.offset)

        // Apply to the camera
        this.camera.position.copy(this.position)
        this.camera.lookAt(this.focusPoint.smoothedPosition)
        this.camera.updateMatrixWorld()
    }

    resize()
    {
        this.camera.aspect = this.game.viewport.ratio
        this.camera.updateProjectionMatrix()
    }
}
