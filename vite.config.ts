import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The three libraries — a texture is a recipe for what a part is made of, a
// component is a recipe for a part, a lamp is a recipe for an assembly of them.
const LIBRARIES = ['models/components', 'models/lamps', 'models/textures']

/**
 * Keep the libraries out of the built site.
 *
 * They used to be *in* it: the folders were copied into `dist` and a listing of
 * each was baked in beside them, because a static site has no directory index
 * and the pickers need one. That made the build a copy of the library, and a
 * copy that only refreshed when code was pushed — so a visitor saw designs as
 * they stood at the last deploy while the person who saved them saw something
 * else. See the head of `src/lib/library.ts`.
 *
 * The library now lives on a branch that everybody reads at run time, so these
 * files answer no request. What is deleted here is not the library — the folders
 * stay in the source, and are what the branch was seeded from — it is a second
 * copy of it, published, stale, and indistinguishable from the real one to
 * anybody who found it.
 *
 * `public/` is copied outside the bundle graph, so this is a delete after the
 * fact rather than files withheld from it.
 */
function unpublishLibraries(): Plugin {
  let outDir = 'dist'
  return {
    name: 'unpublish-libraries',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      for (const dir of LIBRARIES) {
        rmSync(resolve(outDir, dir), { recursive: true, force: true })
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
  plugins: [react(), unpublishLibraries()],
})
