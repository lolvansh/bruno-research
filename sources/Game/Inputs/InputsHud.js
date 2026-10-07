import { Game } from '../Game.js'

// OURS (not Bruno's): a small on-screen readout of the inputs, to SEE what the
// game understands. Press I to show or hide it, or open the page with #inputs.
export class InputsHud
{
    constructor()
    {
        this.game = Game.getInstance()

        this.active = false

        this.element = document.createElement('div')
        this.element.className = 'inputs-hud'
        this.element.style.display = 'none'
        document.body.append(this.element)

        if(location.hash.match(/inputs/i))
            this.setActive(true)

        this.game.inputs.addActions([
            { name: 'inputsHud', categories: [], keys: [ 'Keyboard.KeyI' ] }
        ])

        this.game.inputs.events.on('inputsHud', (action) =>
        {
            if(action.active)
                this.setActive(!this.active)
        })

        // Priority 20: after everything has updated, so we show this frame's values
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 20)
    }

    setActive(active)
    {
        this.active = active
        this.element.style.display = this.active ? 'block' : 'none'
    }

    update()
    {
        if(!this.active)
            return

        const lines = []

        // Every registered action, highlighted while it is active
        for(const action of this.game.inputs.actions.values())
        {
            if(action.name === 'inputsHud')
                continue

            lines.push(`<span class="${action.active ? 'is-on' : ''}">${action.name}</span>`)
        }

        // What the Player turned those actions into
        const player = this.game.player
        let numbers = ''

        if(player)
            numbers = `<br>accelerating ${player.accelerating.toFixed(1)}<br>steering ${player.steering.toFixed(1)}<br>braking ${player.braking.toFixed(1)}<br>boosting ${player.boosting} · suspensions ${player.suspensions.join(' ')}`

        // And what the car is doing about it
        const vehicle = this.game.physicalVehicle

        if(vehicle)
            numbers += `<br>speed ${vehicle.speed.toFixed(1)} · wheels on ground ${vehicle.wheels.inContactCount}/4`

        this.element.innerHTML = lines.join(' ') + numbers
    }
}
