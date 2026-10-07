import './style/index.css'

const canvas = document.querySelector('.js-canvas')
const context = canvas.getContext('2d')

canvas.width = window.innerWidth
canvas.height = window.innerHeight

context.fillStyle = '#ffffff'
context.font = '32px sans-serif'
context.textAlign = 'center'
context.fillText('Surat World: setup works', canvas.width / 2, canvas.height / 2)
