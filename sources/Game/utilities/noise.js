// Smooth random patterns ("value noise"), used to make the island look natural.
//
// Plain random numbers jump around: every point is unrelated to its neighbours.
// Noise is random but SMOOTH: nearby points have similar values, so it makes blobs
// and wobbly lines, like a coastline or patches of grass.
//
// How: put a random number on every whole-number grid point, then blend smoothly
// between the four nearest ones. Seeded, so the same island appears every time.
export function createNoise(seed = 1)
{
    // A random number from 0 to 1 for the grid point (x, y), always the same for the same point
    const hash = (x, y) =>
    {
        let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)
        h = Math.imul(h ^ (h >>> 13), 1274126177)

        return ((h ^ (h >>> 16)) >>> 0) / 4294967296
    }

    // Eases in and out, so the blend has no visible creases at the grid lines
    const smooth = (t) => t * t * (3 - 2 * t)

    const noise = (x, y) =>
    {
        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        const fx = smooth(x - x0)
        const fy = smooth(y - y0)

        const a = hash(x0, y0)
        const b = hash(x0 + 1, y0)
        const c = hash(x0, y0 + 1)
        const d = hash(x0 + 1, y0 + 1)

        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
    }

    // "Fractal" noise: add several layers, each twice as detailed and half as strong.
    // Big smooth shapes with smaller wobbles on top, like real terrain.
    noise.fbm = (x, y, octaves = 4) =>
    {
        let sum = 0
        let amplitude = 0.5
        let frequency = 1
        let total = 0

        for(let i = 0; i < octaves; i++)
        {
            sum += noise(x * frequency, y * frequency) * amplitude
            total += amplitude
            amplitude *= 0.5
            frequency *= 2
        }

        return sum / total
    }

    return noise
}
