// A random number generator that you can SEED.
//
// Math.random() gives different numbers every time you reload. For things like
// "where are the 80 leaf cards of a tree" we want the SAME look every time, so
// the world does not change between reloads. A seeded generator gives the same
// sequence for the same seed.
// (Bruno uses the `seedrandom` package for this; this is a tiny equivalent, "mulberry32".)
export function createRandom(seed = 1)
{
    let state = seed >>> 0

    // Each call returns a number from 0 up to (not including) 1
    return () =>
    {
        state = (state + 0x6D2B79F5) | 0

        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
