Saved lamps live here — *.lamp.json, written by the Lamp tab's file menu.

With a repository token (Library settings, at the foot of any file menu) a save
commits straight into this folder. Without one it downloads the file and you drop
it in by hand — a page has nowhere else to write.

The folder is listed automatically (see the library-index plugin in
vite.config.ts), and the picker re-reads it every time the menu is opened, so a
file dropped in shows up on the next Load… without restarting the dev server.

Format: docs/lamp-file-format.md.

What is in here
---------------

basic          the lamp this project started from, built by hand out of leg,
               beam, frameHorizontal and frameVertical. It is the reference the
               joinery rules were measured off, and the control they are checked
               against, so it is the one file here not to change casually.

andon-*        fourteen carcasses built from the generated kit in
               ../components, structural only — no paper. Each is a different
               *structure*, not a different size: proportions are variables, so
               a lamp that differs only in its numbers is the same lamp and is
               not kept twice.

               The carcass — what the sticks do:

               classic          posts, two rings of horned rails, a frame per face
               flush            rails stopping flush with the post's outer face
               stub             the same outline, mortised only at the corner
               capped           a cap ring over the post heads
               pagoda           a second, longer-horned ring above the cap
               plinth           the lowest ring at the very foot, so it stands on it
               tower            tall, split by a structural ring into two panels
               twin             a sixth post mid-face, the rings threaded through it

               The face — what closes it:

               divided          each face split by a rail in the frame
               capped-divided   a cap ring and divided faces together
               latticed         a bar and a middle rail, four panes to a face
               barred           three full-height bars, no middle rail
               open-front       one face left unframed, to reach the light

               And one that is neither:

               grate            a floor of five slats notched into the bottom ring

Every one of them satisfies docs/joinery-rules.md at eight different sets of
variables. Anything added here should too.
