import './style/index.css'
import { Game } from './Game/Game.js'

// In dev, expose the game on `window` so we can poke at it from the browser console
if(import.meta.env.DEV)
    window.game = new Game()
else
    new Game()
