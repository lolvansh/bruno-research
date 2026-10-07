import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Objects.js (MIT), see LICENSE-THIRD-PARTY.
// Smaller: no sleeping by distance, no reset, no instancing yet.
//
// THE BRIDGE between two separate worlds:
//
//   visual   = a Three.js mesh (what you SEE)
//   physical = a Rapier body   (what the physics MOVES)
//
// They know nothing about each other. An "object" is the pair. Every frame
// we copy the body's position and rotation onto the mesh, so the mesh
// appears to fall, bounce and slide.
export class Objects
{
    constructor()
    {
        this.game = Game.getInstance()

        this.list = new Map()
        this.key = 0

        // Priority 4: right after the physics step (3)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 4)
    }

    // Either part is optional: a mesh with no physics is scenery,
    // a body with no mesh is an invisible wall or floor.
    add(_visualDescription = null, _physicalDescription = null)
    {
        const object = {
            visual: null,
            physical: null
        }

        // Visual
        if(_visualDescription && _visualDescription.model)
        {
            const visual = {}
            visual.object3D = _visualDescription.model

            this.game.materials.updateObject(visual.object3D)
            this.game.scene.add(visual.object3D)

            object.visual = visual
        }

        // Physical
        if(_physicalDescription)
            object.physical = this.game.physics.getPhysical(_physicalDescription)

        // Each side can find the other
        if(object.physical)
            object.physical.body.userData = { object: object }

        if(object.visual)
            object.visual.object3D.userData.object = object

        this.key++
        this.list.set(this.key, object)

        // Place the mesh where the body starts (fixed bodies never move again,
        // so update() would never do it for them)
        if(object.visual && object.physical)
            this.syncVisual(object)

        return object
    }

    // THE NAMING CONVENTION (the big idea of step 8).
    // Read a model made in Blender, and work out its physics from its NAMES:
    //
    //   model name contains "Physical"   -> it has physics (otherwise it is just scenery)
    //   model name contains "Dynamic"    -> it can move; otherwise it is "fixed" (solid, never moves)
    //   a CHILD of the model named...
    //       cuboid...   -> a box.       Its scale is the box size.
    //       ball...     -> a sphere.    Its scale.y is the diameter.
    //       tube...     -> a cylinder.  scale.y = height, scale.x = diameter.
    //       hull...     -> a convex shape wrapped around the child's mesh (cheap, for props)
    //       trimesh...  -> the child's exact triangles (precise but costly: for fixed ground, ramps, bridge decks)
    //   custom properties "friction" / "restitution" on the model or a child -> grip / bounciness
    //
    // The children are only instructions. Once read they are removed, so they never get drawn.
    //
    // Returns [ visualDescription, physicalDescription ], ready for add().
    getFromModel(_model, _visualDescription = {}, _physicalDescription = {})
    {
        const name = _model.name
        const isPhysical = !!name.match(/physical/i)
        const colliders = []

        if(isPhysical)
        {
            // Fixed unless the name says Dynamic
            if(typeof _physicalDescription.type === 'undefined')
                _physicalDescription.type = name.match(/dynamic/i) ? 'dynamic' : 'fixed'

            // Custom properties (Blender "Custom Properties" arrive in userData)
            if(typeof _model.userData.restitution !== 'undefined')
                _physicalDescription.restitution = _model.userData.restitution

            if(typeof _model.userData.friction !== 'undefined')
                _physicalDescription.friction = _model.userData.friction

            // "benchPhysicalDynamic.001" -> "bench.001"
            _model.name = name.replaceAll(/physical|fixed|dynamic/gi, '')

            // The model itself can be scaled (Bruno's benches are 1.09x). The colliders
            // sit INSIDE it, so they are scaled with it. Uniform scale is assumed.
            const parentScale = _model.scale

            for(const child of [ ..._model.children ])
            {
                const collider = {
                    position: {
                        x: child.position.x * parentScale.x,
                        y: child.position.y * parentScale.y,
                        z: child.position.z * parentScale.z
                    },
                    quaternion: child.quaternion
                }

                // Full size of the child in the world's units
                const size = {
                    x: child.scale.x * parentScale.x,
                    y: child.scale.y * parentScale.y,
                    z: child.scale.z * parentScale.z
                }

                if(child.name.match(/^trimesh/i))
                {
                    collider.shape = 'trimesh'
                    collider.parameters = [
                        Objects.scaleVertices(child.geometry.attributes.position.array, size),
                        Uint32Array.from(child.geometry.index.array) // Rapier wants 32 bits
                    ]
                }
                else if(child.name.match(/^hull/i))
                {
                    collider.shape = 'hull'
                    collider.parameters = [ Objects.scaleVertices(child.geometry.attributes.position.array, size) ]
                }
                else if(child.name.match(/^cuboid/i))
                {
                    collider.shape = 'cuboid'
                    collider.parameters = [ size.x * 0.5, size.y * 0.5, size.z * 0.5 ] // Rapier wants HALF sizes
                }
                else if(child.name.match(/^tube/i))
                {
                    collider.shape = 'cylinder'
                    collider.parameters = [ size.y * 0.5, size.x * 0.5 ] // half height, radius
                }
                else if(child.name.match(/^ball/i))
                {
                    collider.shape = 'ball'
                    collider.parameters = [ size.y * 0.5 ] // radius
                }

                if(typeof child.userData.restitution !== 'undefined')
                    collider.restitution = child.userData.restitution

                if(typeof child.userData.friction !== 'undefined')
                    collider.friction = child.userData.friction

                // Only children with a recognised name are colliders
                if(collider.shape)
                {
                    colliders.push(collider)
                    child.removeFromParent()
                }
            }
        }

        return [
            { ..._visualDescription, model: _model },
            isPhysical ? { ..._physicalDescription, colliders: colliders } : null
        ]
    }

    // A mesh stores its points in the mesh's OWN size. Apply the scale so the collider matches.
    // (In Blender: "apply scale" (Ctrl+A) on trimesh/hull objects keeps this at 1.)
    static scaleVertices(array, scale)
    {
        if(scale.x === 1 && scale.y === 1 && scale.z === 1)
            return array

        const scaled = new Float32Array(array.length)

        for(let i = 0; i < array.length; i += 3)
        {
            scaled[i + 0] = array[i + 0] * scale.x
            scaled[i + 1] = array[i + 1] * scale.y
            scaled[i + 2] = array[i + 2] * scale.z
        }

        return scaled
    }

    // Shortcut: read the names, then add. The model's own position and rotation
    // become the body's, unless the description says otherwise.
    addFromModel(_model, _visualDescription = {}, _physicalDescription = {})
    {
        const [ visual, physical ] = this.getFromModel(_model, _visualDescription, _physicalDescription)

        if(physical)
        {
            physical.position = physical.position ?? _model.position.clone()
            physical.rotation = physical.rotation ?? _model.quaternion.clone()
        }

        return this.add(visual, physical)
    }

    syncVisual(object)
    {
        object.visual.object3D.position.copy(object.physical.body.translation())
        object.visual.object3D.quaternion.copy(object.physical.body.rotation())
    }

    update()
    {
        this.list.forEach((object) =>
        {
            // Only bodies that are moving need copying. Resting ones are "asleep".
            if(object.visual && object.physical && !object.physical.body.isSleeping())
                this.syncVisual(object)
        })
    }
}
