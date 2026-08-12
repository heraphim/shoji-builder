/**
 * The variable expression language.
 *
 * Small arithmetic language: numbers, `+ - * /`, parens, identifiers (variable
 * references). Every number the user can type — a design variable, a
 * measurement, a block size — is stored as one of these *strings*, never as a
 * number, so `1/2*#innerWidth` keeps its meaning after the inner width changes.
 *
 * Grammar (recursive descent, one function per precedence level):
 *
 *     expr    = term  { ("+" | "-") term } ;      left-associative
 *     term    = unary { ("*" | "/") unary } ;     left-associative
 *     unary   = "-" unary | primary ;
 *     primary = number | identifier | "(" expr ")" ;
 *     identifier = [ "#" ] letter { letter | digit | "_" } ;
 *
 * `#` is an optional sigil: `#innerWidth` and `innerWidth` parse the same.
 *
 * Pipeline: tokenize -> parse -> evaluate, with `resolveVariables` on top doing
 * a memoised depth-first walk of the dependency graph (equivalent to a
 * topological sort, but it never has to build the ordering, and the visiting
 * set yields a readable cycle path instead of a stack overflow).
 *
 * Algorithms and error behaviour: docs/algorithms/formula-resolution.md
 */

type Token =
  | { type: "number"; value: string }
  | { type: "identifier"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

/**
 * Single linear scan over the source. O(n) in characters.
 *
 * @throws on an unexpected character, or on a `#` not followed by a name.
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const text = expr.slice(i, j);
      // The scan is greedy over digits and dots, so "1.2.3" arrives here as one
      // token. parseFloat would quietly read it as 1.2 — a wrong number nothing
      // downstream can tell from a right one, which is worse than a failure.
      if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) {
        throw new Error(`Malformed number "${text}" in formula "${expr}"`);
      }
      tokens.push({ type: "number", value: text });
      i = j;
      continue;
    }
    // "#" is an optional variable-reference sigil: #innerWidth === innerWidth
    if (c === "#" || /[A-Za-z_]/.test(c)) {
      const start = c === "#" ? i + 1 : i;
      if (c === "#" && !/[A-Za-z_]/.test(expr[start] ?? "")) {
        throw new Error(`"#" must be followed by a variable name in formula "${expr}"`);
      }
      let j = start;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      tokens.push({ type: "identifier", value: expr.slice(start, j) });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in formula "${expr}"`);
  }
  return tokens;
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "bin"; op: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { kind: "neg"; arg: Node };

/**
 * Recursive descent over the grammar above. O(n) in tokens.
 *
 * Both binary levels loop rather than recursing on the right, which is what
 * makes them left-associative. Trailing input after a complete expression is an
 * error — that is what catches `1 2` and `(1+2))`.
 *
 * @throws on any syntax error, quoting the whole formula.
 */
function parse(expr: string): Node {
  const tokens = tokenize(expr);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): Node {
    let node = parseTerm();
    for (;;) {
      const tok = peek();
      if (!tok || tok.type !== "op" || (tok.value !== "+" && tok.value !== "-")) break;
      next();
      node = { kind: "bin", op: tok.value, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm(): Node {
    let node = parseUnary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.type !== "op" || (tok.value !== "*" && tok.value !== "/")) break;
      next();
      node = { kind: "bin", op: tok.value, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary(): Node {
    const tok = peek();
    if (tok && tok.type === "op" && tok.value === "-") {
      next();
      return { kind: "neg", arg: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const tok = peek();
    if (!tok) throw new Error(`Unexpected end of formula "${expr}"`);
    if (tok.type === "number") {
      next();
      return { kind: "num", value: parseFloat(tok.value) };
    }
    if (tok.type === "identifier") {
      next();
      return { kind: "var", name: tok.value };
    }
    if (tok.type === "lparen") {
      next();
      const node = parseExpr();
      if (peek()?.type !== "rparen") throw new Error(`Expected ")" in formula "${expr}"`);
      next();
      return node;
    }
    throw new Error(`Unexpected token in formula "${expr}"`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error(`Unexpected trailing input in formula "${expr}"`);
  return result;
}

/**
 * Plain AST tree walk. O(n) in nodes.
 *
 * Division by zero is not special-cased: IEEE Infinity/NaN propagates and is
 * rejected by the callers' finiteness checks (`rebuildBlocks` refuses a size
 * that is not finite and positive), which keeps the failure local to the one
 * block instead of throwing out of a render.
 *
 * @throws when the expression names a variable the scope does not carry.
 */
function evaluate(node: Node, scope: Record<string, number>): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var":
      if (!(node.name in scope)) throw new Error(`Unknown variable "${node.name}"`);
      return scope[node.name];
    case "neg":
      return -evaluate(node.arg, scope);
    case "bin": {
      const l = evaluate(node.left, scope);
      const r = evaluate(node.right, scope);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
      }
    }
  }
}

/** Every distinct identifier a formula mentions, in first-seen order. */
export function extractIdentifiers(expr: string): string[] {
  const matches = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Resolves a dict of raw formula strings (numbers, or expressions referencing
 * other keys) into numbers, evaluating dependencies first.
 *
 * Depth-first traversal of the dependency graph with memoisation (`resolved`)
 * and an explicit visiting set — O(V + E), each variable parsed and evaluated
 * once. The visiting set is what turns a cycle into a readable
 * `a -> b -> c -> a` message rather than a stack overflow.
 *
 * Dependencies are filtered to `id in raw`, so an identifier that is *not* a
 * known variable is left out of the scope and `evaluate` throws `Unknown
 * variable` — the error the user should see — rather than it being silently
 * treated as zero.
 *
 * Callers that want to evaluate a single ad-hoc expression inject it under a
 * reserved key (`__measurement`, `__size0`…) and read that key back.
 *
 * @throws on an unknown variable, a circular reference, or a syntax error.
 */
export function resolveVariables(raw: Record<string, string>): Record<string, number> {
  const resolved: Record<string, number> = {};
  const visiting = new Set<string>();

  function resolveOne(name: string, path: string[]): number {
    if (name in resolved) return resolved[name];
    if (!(name in raw)) throw new Error(`Unknown variable "${name}"`);
    if (visiting.has(name)) {
      throw new Error(`Circular reference: ${[...path, name].join(" -> ")}`);
    }
    visiting.add(name);
    const ast = parse(raw[name]);
    const deps = extractIdentifiers(raw[name]).filter((id) => id in raw);
    const scope: Record<string, number> = {};
    for (const dep of deps) {
      scope[dep] = resolveOne(dep, [...path, name]);
    }
    const value = evaluate(ast, scope);
    visiting.delete(name);
    resolved[name] = value;
    return value;
  }

  for (const name of Object.keys(raw)) {
    resolveOne(name, []);
  }

  return resolved;
}
