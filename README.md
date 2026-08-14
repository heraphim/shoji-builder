# The library

This branch is **data, not code**. It holds every component, lamp and texture the
[Shoji Lamp Configurator](https://heraphim.github.io/shoji-builder/) offers, and
nothing else — no source, no workflows, no build. There is nothing here to run.

It is an orphan branch: it shares no history with `main` and never merges into
it. If you have arrived here looking for the app, it is on
[`main`](../../tree/main).

## Why it exists

The app is a static site with no server, so a design used to have two homes and
they disagreed. The libraries were copied into the build, so a visitor saw them
as they stood at the last push of **code** — and saving a design does not push
code. Whoever held a write token read this branch instead and saw something else.
Same app, two libraries, and nothing on screen to say which one you had.

Now everyone reads this branch. Without a token that is
`raw.githubusercontent.com`, which needs no credentials and does not spend the
sixty API requests an hour that every visitor on a network shares. With one it is
the GitHub contents API against this same branch — not for permission, which
reading never needs, but because the person who has just saved is the one person
for whom a five-minute-old answer is obviously wrong.

A save is a commit here. It does not deploy anything, and costs no Actions
minutes.

## What is in it

```
public/models/
  components/         a recipe for a part
  lamps/              a recipe for an assembly of parts
  textures/           a recipe for what a part is made of
  textures-rejected/  woods the generator turned down, kept out of the way
```

The paths keep their `public/models/` prefix because that is where these files
live in the source on `main`, which this branch was seeded from — one path,
whichever way you arrive at a file.

Each of the three libraries carries an `index.json` of its own names.
`raw.githubusercontent.com` serves a file and never a folder, so it is the only
way a reader without a token can ask what is in a library.

**Do not maintain `index.json` by hand.** A listing kept beside the things it
lists is a listing that drifts from them, so nothing is trusted to remember: the
app rebuilds it from this branch inside the very commit that changes a library
(`commitFiles` in `src/lib/library.ts` on `main`). A file cannot land unlisted,
because landing is what lists it. If you do add a file by hand and the app cannot
see it, the next save through the app corrects the listing for you.

## Writing to it

Through the app, from **Library settings…** at the foot of any file menu, with a
fine-grained token scoped to this repository and **Contents: read and write**. The
token stays in that browser's `localStorage`; it is never in the source and never
in the bundle.

Be aware that a fine-grained token **cannot be restricted to a single branch**. A
token issued so somebody can save a lamp can also push to `main`, which is the app
itself — worth a protection ruleset on `main` before handing one to anybody else.

## Please do not open pull requests against this branch

Nothing here is reviewed and nothing here is built. A fix to the app belongs on
[`main`](../../tree/main); a new lamp belongs in the app, which will commit it
here itself.
