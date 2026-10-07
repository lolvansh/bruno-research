import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import * as THREE from 'three/webgpu'

// Adapted from Bruno Simon's folio-2025 ResourcesLoader.js (MIT),
// see LICENSE-THIRD-PARTY.
//
// Loads files (images, 3D models) and tells us how far along it is.
//
// You give it a list. Each item is:  [ name, path, type, optionalTweak ]
//   name  = the key you will find the result under
//   path  = the file, relative to the static/ folder
//   type  = 'texture' or 'gltf'
//   tweak = a function that receives the loaded thing and can adjust it
//
// Not here yet (Bruno has them): KTX2 compressed textures. We add that
// when we get to compression.
export class ResourcesLoader
{
    constructor()
    {
        this.loaders = new Map()
        this.cache = new Map()
    }

    getLoader(_type)
    {
        // Each loader is created once, then reused
        if(this.loaders.has(_type))
            return this.loaders.get(_type)

        let loader = null

        if(_type === 'texture')
        {
            loader = new THREE.TextureLoader()
        }
        else if(_type === 'draco')
        {
            // Draco = a way of shrinking 3D models a lot. It needs a small decoder
            // program (static/draco/) to unpack them in the browser.
            loader = new DRACOLoader()
            loader.setDecoderPath('./draco/')
            loader.preload()
        }
        else if(_type === 'gltf')
        {
            // GLTF/GLB = the standard 3D model file format for the web
            loader = new GLTFLoader()
            loader.setDRACOLoader(this.getLoader('draco'))
        }

        this.loaders.set(_type, loader)

        return loader
    }

    load(_files, _progressCallback = null)
    {
        return new Promise((resolve, reject) =>
        {
            let toLoad = _files.length
            const loadedResources = {}

            // One file finished: update the counter, and resolve when all are done
            const progress = () =>
            {
                toLoad--

                if(typeof _progressCallback === 'function')
                    _progressCallback(toLoad, _files.length)

                if(toLoad === 0)
                    resolve(loadedResources)
            }

            // Keep the result
            const save = (_file, _resource) =>
            {
                // Let the caller tweak it first (filters, colour space...)
                if(typeof _file[3] !== 'undefined')
                    _file[3](_resource)

                loadedResources[_file[0]] = _resource
                this.cache.set(_file[1], _resource)
            }

            const error = (_file) =>
            {
                console.log(`Resources > Couldn't load file ${_file[1]}`)
                reject(_file[1])
            }

            // All files start loading at the same time
            for(const _file of _files)
            {
                // Already loaded earlier
                if(this.cache.has(_file[1]))
                {
                    loadedResources[_file[0]] = this.cache.get(_file[1])
                    progress()
                }

                // Not yet
                else
                {
                    const loader = this.getLoader(_file[2])
                    loader.load(
                        _file[1],
                        resource =>
                        {
                            save(_file, resource)
                            progress()
                        },
                        undefined,
                        () => error(_file)
                    )
                }
            }
        })
    }
}
