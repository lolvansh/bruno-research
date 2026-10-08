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
        this.setMapView()

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

        // The wheel is an action like any other. The angle never changes, only the distance.
        this.game.inputs.addActions([
            { name: 'zoom', categories: [ 'wandering' ], keys: [ 'Wheel.roll' ] },
        ])

        this.game.inputs.events.on('zoom', (action) =>
        {
            // Scroll down (positive value) = zoom out. In map mode the wheel zooms the map instead.
            if(this.map && this.map.active)
            {
                this.map.ratio = THREE.MathUtils.clamp(this.map.ratio - action.value * 0.06, 0, 1)
                return
            }

            this.zoom.baseRatio -= action.value * this.zoom.sensitivity
            this.zoom.baseRatio = THREE.MathUtils.clamp(this.zoom.baseRatio, 0, 1)
        })
    }

    // TOP-DOWN MAP VIEW (press M). The camera jumps straight overhead and looks down, so you can
    // see the whole island like the hand-drawn map. The mouse wheel zooms in and out.
    // `ratio` 0 = see the whole island, 1 = zoomed right in. It follows the car, so M also works as a minimap.
    setMapView()
    {
        this.map = {}
        this.map.active = false
        this.map.ratio = 0.3 // Start fairly far out
        this.map.heightEdges = { min: 90, max: 360 } // Camera height for ratio 1 and 0
        this.map.smoothedCenter = new THREE.Vector3()
        this.map.smoothedHeight = THREE.MathUtils.lerp(this.map.heightEdges.max, this.map.heightEdges.min, this.map.ratio)

        this.game.inputs.addActions([
            { name: 'mapView', categories: [ 'wandering' ], keys: [ 'Keyboard.KeyM' ] },
        ])

        this.game.inputs.events.on('mapView', (action) =>
        {
            // Fires on press AND release; only toggle on the press
            if(action.active)
                this.map.active = !this.map.active
        })
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
        // 25 degrees is a narrow field of view: flatter, more "miniature diorama" look.
        // The far plane reaches 600 so the high overhead map view still sees the ground.
        this.camera = new THREE.PerspectiveCamera(25, this.game.viewport.ratio, 0.1, 600)
        this.game.scene.add(this.camera)
    }

    update()
    {
        const delta = this.game.ticker.delta

        // MAP VIEW: straight overhead, looking down, following the car. The wheel sets the height.
        if(this.map.active)
        {
            const target = this.focusPoint.trackedPosition
            const targetHeight = THREE.MathUtils.lerp(this.map.heightEdges.max, this.map.heightEdges.min, this.map.ratio)

            this.map.smoothedCenter.lerp(target, Math.min(1, delta * 8))
            this.map.smoothedHeight = THREE.MathUtils.lerp(this.map.smoothedHeight, targetHeight, Math.min(1, delta * 8))

            this.camera.position.set(this.map.smoothedCenter.x, this.map.smoothedHeight, this.map.smoothedCenter.z)
            this.camera.up.set(0, 0, 1) // +z (the far bank) points up the screen, like the drawn map
            this.camera.lookAt(this.map.smoothedCenter.x, 0, this.map.smoothedCenter.z)
            this.camera.updateMatrixWorld()
            return
        }

        // Leaving map view: put the camera's up vector back for the normal angled view
        this.camera.up.set(0, 1, 0)

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
