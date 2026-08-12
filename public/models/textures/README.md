# Texture library

`*.texture.json` files listed by the Textures tab's **Load…** menu and offered to
every component by the Component Editor's **Texture** panel.

Same round trip as `models/components` and `models/lamps`: with a repository
token (Library settings, at the foot of any file menu) **Save** commits straight
into this folder, and without one it downloads a file for you to drop in here.
The listing (`index.json`) is served by the Vite plugin in `vite.config.ts` and
is re-read on every request in dev, so a file dropped in shows up without a
restart.

A texture file is a **recipe**, never an image: the parameter set that generates
the wood, including the seed. Two saves of the same texture are the same bytes,
and a texture opened next year regenerates the same board. Format and field
meanings: `src/lib/textureFile.ts` and `src/lib/wood.ts`.

The three shipped here are starting points, not a catalogue — the whole point of
the tab is that you make your own.
