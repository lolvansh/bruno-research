// The loading screen is plain HTML (see .loading in index.html and index.css).
// Bruno's intro is built inside the 3D scene; ours is a simple overlay.
export class LoadingScreen
{
    constructor()
    {
        this.element = document.querySelector('.loading')
        this.fill = this.element.querySelector('.js-loading-fill')
    }

    // progress goes from 0 (nothing loaded) to 1 (everything loaded)
    setProgress(progress)
    {
        this.fill.style.transform = `scaleX(${progress})`
    }

    hide()
    {
        this.element.classList.add('is-hidden')
    }
}
