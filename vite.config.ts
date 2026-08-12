import { existsSync, readdirSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Both pickers offer exactly what is in their folder, so each needs a listing of
// it — static file serving has none. Dev reads the folder per request, so
// dropping a file in shows up without restarting the server; build bakes the
// listing into dist.
//
// The three libraries work the same way because they are the same idea at three
// levels: a texture is a recipe for what a part is made of, a component is a
// recipe for a part, a lamp is a recipe for an assembly of them. All are
// exported to the user's downloads and dropped into the folder by hand — the
// browser cannot write to the project.
const LIBRARIES = ['models/components', 'models/lamps', 'models/textures']

function libraryIndex(): Plugin {
  const list = (dir: string) =>
    existsSync(`public/${dir}`)
      ? readdirSync(`public/${dir}`)
          .filter((name) => name.endsWith('.json') && name !== 'index.json')
          .sort()
      : []

  return {
    name: 'library-index',
    configureServer(server) {
      // Under the base the app is actually served from, not at the root: the
      // dev server does not strip it before the middleware stack, so a listing
      // registered at `/models/…` is never reached and every request for one
      // falls through to the index.html catch-all — a listing that parses as
      // HTML and an empty library with no error to say why.
      const { base } = server.config
      for (const dir of LIBRARIES) {
        server.middlewares.use(`${base}${dir}/index.json`, (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(list(dir)))
        })
      }
    },
    generateBundle() {
      for (const dir of LIBRARIES) {
        this.emitFile({
          type: 'asset',
          fileName: `${dir}/index.json`,
          source: JSON.stringify(list(dir)),
        })
      }
    },
  }
}

// GitHub Pages serves a project site from `/<repo>/`, not from the root, so every
// asset and every fetch has to be written against that prefix — see `siteUrl` in
// src/lib/library.ts. The same prefix is used in dev, so the one path is the path
// that gets tested. Override it when the repository is named something else:
//
//     VITE_BASE=/my-fork/ npm run build
//
// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/shoji-builder/',
  plugins: [react(), libraryIndex()],
})
