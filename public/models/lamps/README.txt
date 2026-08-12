Saved lamps live here — *.lamp.json, written by the Lamp tab's file menu.

With a repository token (Library settings, at the foot of any file menu) a save
commits straight into this folder. Without one it downloads the file and you drop
it in by hand — a page has nowhere else to write.

The folder is listed automatically (see the library-index plugin in
vite.config.ts), and the picker re-reads it every time the menu is opened, so a
file dropped in shows up on the next Load… without restarting the dev server.

Format: docs/lamp-file-format.md.
