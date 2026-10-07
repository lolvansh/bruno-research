import { Game } from './Game.js'

// Adapted from Bruno Simon's folio-2025 Objects.js (MIT), see LICENSE-THIRD-PARTY.
// Much smaller: no collider-from-Blender-names yet (step 8), no sleeping by
// distance, no reset.
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
