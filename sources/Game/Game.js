import * as THREE from 'three/webgpu'

import { Ticker } from './Ticker.js'
import { Viewport } from './Viewport.js'
import { View } from './View.js'
import { Rendering } from './Rendering.js'
import { LoadingScreen } from './LoadingScreen.js'
import { ResourcesLoader } from './ResourcesLoader.js'
import { Materials } from './Materials.js'
import { Physics } from './Physics/Physics.js'
import { PhysicsWireframe } from './Physics/PhysicsWireframe.js'
import { PhysicsVehicle } from './Physics/PhysicsVehicle.js'
import { Objects } from './Objects.js'
import { Inputs } from './Inputs/Inputs.js'
import { InputsHud } from './Inputs/InputsHud.js'
import { Player } from './Player.js'
import { Lighting } from './Lighting.js'
import { Terrain } from './Terrain.js'
import { Water } from './Water.js'
import { World } from './World/World.js'

// The one object that owns everything. Any other class can get it with
// Game.getInstance() instead of passing it around (same pattern as Bruno).
export class Game
{
    static getInstance()
    {
        return Game.instance
    }

    constructor()
    {
        // Singleton: a second `new Game()` returns the first one
        if(Game.instance)
            return Game.instance

        Game.instance = this

        this.init()
    }

    async init()
    {
        // DOM
        this.domElement = document.querySelector('.game')
        this.canvasElement = this.domElement.querySelector('.js-canvas')

        // Core
        this.loadingScreen = new LoadingScreen()
        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color('#13375f') // Deep sea: the same colour as the water beyond the island
        this.ticker = new Ticker()
        this.viewport = new Viewport(this.domElement)

        // Inputs come before View, because View registers the zoom action on it
        this.inputs = new Inputs()

        // The camera lives inside View. Needs the scene, ticker and viewport above.
        this.view = new View()

        // The renderer must be ready before anything can be drawn
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        // Rapier is a big WebAssembly program. Start fetching it now, in parallel
        // with the files below (that is why it is a dynamic import, not a top import).
        const rapierPromise = import('@dimforge/rapier3d')

        // Load everything the world needs, moving the loading bar as files arrive
        this.resourcesLoader = new ResourcesLoader()
        const resourcesPromise = this.resourcesLoader.load(
            [
                [ 'paletteTexture', 'palette.png', 'texture', (resource) =>
                {
                    resource.colorSpace = THREE.SRGBColorSpace // The image holds sRGB colours
                    resource.minFilter = THREE.NearestFilter // Never blend neighbouring swatches...
                    resource.magFilter = THREE.NearestFilter // ...when zoomed out or in
                    resource.generateMipmaps = false // Mipmaps are blurred copies: they would blend swatches too
                } ],
                [ 'benchesModel', 'benches/benches.glb', 'gltf' ],
                [ 'fencesModel', 'fences/fences.glb', 'gltf' ],
                [ 'foliageTexture', 'foliage/foliageSDF.png', 'texture', (resource) =>
                {
                    resource.minFilter = THREE.NearestFilter // It is a shape mask, not a picture: never blur it
                    resource.magFilter = THREE.NearestFilter
                    resource.generateMipmaps = false
                } ],
                [ 'floorSlabsTexture', 'floor/slabs.png', 'texture', (resource) =>
                {
                    resource.wrapS = THREE.RepeatWrapping // The paving pattern tiles forever
                    resource.wrapT = THREE.RepeatWrapping
                    resource.minFilter = THREE.LinearFilter
                    resource.magFilter = THREE.LinearFilter
                    resource.generateMipmaps = false
                } ],
                [ 'birchTreesVisualModel', 'birchTrees/birchTreesVisual.glb', 'gltf' ],
                [ 'oakTreesVisualModel', 'oakTrees/oakTreesVisual.glb', 'gltf' ],
                [ 'cherryTreesVisualModel', 'cherryTrees/cherryTreesVisual.glb', 'gltf' ],
                [ 'cableBridgeModel', 'cableBridge/cableBridge.glb', 'gltf' ],
                [ 'landmarksModel', 'landmarks/landmarks.glb', 'gltf' ],
                // The Thar by default. Add #car=sedan to the address to load vehicle/sedan.glb instead.
                [ 'vehicleModel', `vehicle/${(location.hash.match(/car=([\w-]+)/i) ?? [ null, 'thar' ])[1]}.glb`, 'gltf' ],
            ],
            (toLoad, total) =>
            {
                this.loadingScreen.setProgress(1 - toLoad / total)
            }
        )

        // Wait for both: the files AND the physics engine
        const [ resources, RAPIER ] = await Promise.all([ resourcesPromise, rapierPromise ])
        this.resources = resources
        this.RAPIER = RAPIER

        // Now everything exists, so the systems that use them can be built
        this.water = new Water() // Before Materials: they paint a waterline at its height
        this.materials = new Materials()
        this.lighting = new Lighting()
        this.terrain = new Terrain() // The island map. The floor, grass and trees all ask it.
        this.physics = new Physics() // Priority 3
        this.wireframe = new PhysicsWireframe() // Priority 4
        this.objects = new Objects() // Priority 4
        this.physicalVehicle = new PhysicsVehicle() // Priority 2 and 5
        this.player = new Player() // Priority 1 and 6 (needs the vehicle to place it)
        this.inputsHud = new InputsHud() // Priority 20

        // Content
        this.world = new World()

        // Start drawing, and uncover the game
        this.rendering.start()
        this.loadingScreen.hide()
    }
}
