# Formula resolution

`src/lib/formula.ts`

Every number the user can type — a design variable, a measurement, a block size —
is stored as a **string**, never as a number. `resolveVariables` turns a whole
dictionary of those strings into numbers, in dependency order.

Storing the string is the point: `1/2*#innerWidth` keeps its *meaning*, so it
still means half the inner width after the inner width changes.

## Grammar

```ebnf
expr    = term    { ("+" | "-") term } ;
term    = unary   { ("*" | "/") unary } ;
unary   = "-" unary | primary ;
primary = number | identifier | "(" expr ")" ;

number     = digit { digit | "." } ;
identifier = [ "#" ] letter { letter | digit | "_" } ;
```

`#` is an optional sigil on a variable reference: `#innerWidth` and `innerWidth`
parse to the same node. It exists so a formula reads as a reference in the UI
(and so the chip buttons in the sidebar can insert something unambiguous). A `#`
not followed by a name is an error.

No functions, no exponentiation, no comparison — deliberately. The language is
as small as it can be while still expressing "half of", "two of these plus a
gap", "the overall minus two thicknesses".

## Pipeline

### 1. `tokenize(expr) → Token[]`

Single linear scan. Whitespace skipped; digits and `.` accumulate into a
`number`; `#`/letter starts an `identifier`; `+ - * /`, `(`, `)` are punctuation.
Anything else throws with the offending character and the whole formula quoted.

`O(n)` in characters.

> The number scan is greedy over digits and dots, so `1.2.3` arrives as a single
> token. It is then validated before being accepted: `parseFloat` would read it
> as `1.2`, and a wrong number nothing downstream can distinguish from a right
> one is worse than a failure. A malformed number throws.

### 2. `parse(expr) → Node`

Recursive descent, one function per precedence level — `parseExpr` (additive) →
`parseTerm` (multiplicative) → `parseUnary` → `parsePrimary`. Left-associative
at both binary levels because each loops rather than recursing on the right.
Unary minus recurses into itself, so `--x` parses.

Trailing input after a complete expression is an error, which catches `1 2` and
`(1+2))`.

`O(n)` in tokens.

The AST is four node kinds:

```ts
{ kind: "num"; value }
{ kind: "var"; name }
{ kind: "bin"; op; left; right }
{ kind: "neg"; arg }
```

### 3. `evaluate(node, scope) → number`

Plain tree walk. A `var` not present in `scope` throws `Unknown variable "x"`.
Division does not check for zero — IEEE `Infinity`/`NaN` propagates and is caught
by the callers' finiteness checks (`rebuildBlocks` rejects non-finite or
non-positive sizes).

`O(n)` in nodes.

### 4. `resolveVariables(raw) → Record<string, number>`

The interesting one. `raw` is `{ name → formula }` where formulas may reference
other names in the same dictionary.

```
for each name in raw:
    resolveOne(name, [])

resolveOne(name, path):
    if name already resolved:  return memo
    if name not in raw:        throw Unknown variable
    if name is on the stack:   throw Circular reference: a -> b -> a
    mark name as visiting
    parse its formula
    for each identifier it mentions that is also a key of raw:
        resolveOne(dependency, path + [name])      # depth-first
    value = evaluate(ast, resolved dependencies)
    unmark, memoise, return value
```

This is a **depth-first traversal of the dependency graph with memoisation and
an explicit visiting set** — equivalent to a topological sort, but it never has
to build the ordering, and the visiting set gives a readable cycle path
(`a -> b -> c -> a`) instead of a stack overflow.

`O(V + E)`: each variable is parsed and evaluated once, each edge walked once.

Two details that matter:

- **Dependency filtering.** `extractIdentifiers` is a regex over the raw string,
  and its results are filtered to `id in raw`. An identifier that is *not* a
  known variable is left out of the scope, so `evaluate` throws
  `Unknown variable` — the error the user should see — rather than the resolver
  silently treating it as 0.
- **Scope is per-variable**, built from just that formula's dependencies. A
  variable cannot accidentally see a sibling it did not name.

## Ad-hoc evaluation of one expression

Several call sites need "evaluate this one formula against the current
variables" without adding it to the store. They all use the same trick: inject
it under a reserved key and read that key back.

```ts
resolveVariables({ ...raw, __measurement: formula }).__measurement
```

- `OrthographicView.evaluateFormula` and `ComponentEditorSidebar.evaluateFormula`
  — `__measurement`, for dimension text and the measurement list.
- `useComponentEditorStore.evaluateAll` — `__size0`, `__size1`, `__size2`, so a
  block's three axis formulas resolve in one pass against one scope.

All of them return `null` on a throw **or on a non-finite result** — resolving
without throwing is not enough, since `1/0` yields `Infinity`. Every caller then
renders `?` or keeps the previous geometry. **A bad formula never breaks the
model** — it just fails to produce a number.

The UI gate on a new measurement is stricter still: it requires a *positive*
value, because `rebuildBlocks` refuses a size that is not `> 0`, and accepting
one would store a measurement the geometry silently ignores.

## Error handling summary

| Input | Result |
| --- | --- |
| `2 +` | throws `Unexpected end of formula` |
| `#` | throws `"#" must be followed by a variable name` |
| `2 $ 3` | throws `Unexpected character "$"` |
| `1 2` | throws `Unexpected trailing input` |
| `nosuchvar` | throws `Unknown variable "nosuchvar"` |
| `a` where `a = b`, `b = a` | throws `Circular reference: a -> b -> a` |
| `1/0` | `Infinity` — treated as unevaluable by callers (`?`), rejected by the geometry's finiteness check |
| `1.2.3`, `2..5` | throws `Malformed number` |

`useResolvedVariables` catches the throw and surfaces the message in the
variables panel; the geometry keeps whatever it last successfully built.

## Related: variable pairing

`useVariablesStore` uses the language rather than special-casing. Two variables
can be declared a pair in `variables.json`:

```json
"innerWidth": { "value": "200", "pairedWith": "innerDepth", "paired": true },
"innerDepth": { "value": "200" }
```

When the pair is *collapsed*, the dependent's raw value is literally set to the
string `"#innerWidth"`. It then follows the driver on every edit with no extra
wiring at all — the resolver already does the work. The dependent's own value is
parked in `stashed` and restored when the pair is expanded, so toggling square
mode off gives back the last independent depth rather than freezing at whatever
the width happened to be.
