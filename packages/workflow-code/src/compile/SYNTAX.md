# Workflow source syntax the compiler accepts

The compiler (`compileWorkflow`) accepts exactly what the printer emits, plus a few hand-written
conveniences listed under "Also accepted". `printer-goldens.test.ts` compiles
every printer golden, over the real catalog, with zero errors to a workflow that runs as the one it
was printed from. Where s2 and s3 disagreed, the printer's choice (build-spec first, then s2) was
taken.

**Source holds what executes** (DESIGN.md A18). A file states every value the serializer sends or
deploy reads, wiring, branches and the config of the loop or parallel type in effect. What only
the canvas cares about is never required: which member of a basic/advanced pair shows a value,
whether a selector or a typed value produced an id, inactive values, the other loop or parallel
types' fields, layout and unknown residue. Source has no syntax for it: the printer leaves it out
and apply keeps it from the stored workflow (`materialize/preserve.ts`).

**Defaults rule.** An omitted param is the editor default canvas creation writes (the catalog's
`valueDefault` for a visible field, `defaultValue` for a hidden one), so a block written with no
params is stored as a canvas-created one. `null` is stored-absent. The printer omits a value equal
to the default and writes `null` for an active field that has a default but no stored value.

## File

- Line 1 is `// @sim-sdk N`; a missing header is `E_SDK_HEADER`, `N` above the caller's major is
  `E_SDK_MAJOR`.
- Imports: named imports from `'@sim/workflow-sdk'` only (aliases allowed). Anything else is
  `E_UNSUPPORTED_SYNTAX`.
- Exactly one `export default workflow(name, options?, body)`. `options` is
  `{ description?, variables? }`. `body` is `() => { ... }` or `({ vars }) => { ... }`.
- Variables: `variables: { <key>: { name?, type, value } }`. The property key is the variable
  key; `name` is written only when it differs from the key. `value` is plain JSON.

## Blocks

- `const x = builder('Name', params?, meta?)`, or a bare `builder(...)` statement (no binding).
  The builder is the dotted catalog path (`slack.sendMessage`, `trigger.gmail.poller`).
- `block(type, 'Name', params?, meta?)` for any type: unknown, legacy, or a builder that does not
  fit. With a catalog type, params are checked against its fields; without one, they are kept
  verbatim.
- Params: a subBlock id, or the `canonicalParamId` for every subBlock group sharing one (even a
  group of one). Writing a group member by its own id is `E_UNKNOWN_PARAM` with a hint. A pinned
  id (`operation`, a builder's `fixed`) is `E_FIXED_PARAM`; the compiler adds pinned values.
- Pair mode follows from the value kind alone; there is no `meta.modes`. A selector call
  (`binding`, `table`, `kb`, `workflow`, `skill`, `customTool`, `mcp`, `sandbox`, `folder`,
  `upload`) or a non-empty array of them is basic, anything else advanced, except that a list or
  object literal never lands in a JSON code member (subBlock type `code`) when the pair's other
  member is not code: it goes to that other member as written (`table_v2`'s `filterInput`: a list
  is the filter builder's, JSON text the code editor's). The printer writes a JSON code member's
  value as the text it stores (the catalog gives such a member value kind `json`), never as the
  literal it stringifies, so both directions are unambiguous. Every group on the block gets a mode; an unwritten group is `basic`. On apply the
  mode is canvas state: when the pair's value is unchanged the stored member and mode stay, and a
  plain id written where the stored block shows the selector member stays in that member.
- `meta`: `key`, `disabled`, `locked`, `advancedMode`, `triggerMode` (any builder), `errorPort`,
  `retry: { enabled, maxTries, waitBetweenTriesMs }`, `branches`, `extra`, `extraData`
  (containers only).
- A builder prints only blocks on its own surface: a trigger-mode builder never prints an action
  block, nor an action builder a block in trigger mode (a trigger block's builders fit either);
  such a block prints through `block()`.
- `meta.key: '<key>'` (a string literal) keeps a legacy key that the display name cannot carry.
  The printer writes it only for such a block, and the compiler accepts it only when the key is in
  `CompileInput.knownKeys` (the stored workflow's keys, from the lock or `code_meta`) and is one of
  the two legacy shapes canonicalize produces:
  - the `~n` collision form of the normalized name (`api('agent1', {...}, { key: 'agent1~2' })`
    next to `api('Agent 1', ...)`), with the plain key declared by another block;
  - the normalized name itself when it is reserved (`api('Loop', {...}, { key: 'loop' })`).

  Anything else is `E_KEY_OVERRIDE`, and the block falls back to its normalized name (so a
  reserved name then also reports `E_RESERVED_NAME`). Source can therefore round-trip such a block
  losslessly but never introduce one; renaming the block on the canvas or in source retires the
  override.
- `errorPort` in the CWM is `meta.errorPort || the block has an error edge`.
- `extra: { <subBlockId>: value }` holds stored params that run but have no SDK syntax, and is
  the only place source takes them: a schema-agnostic custom block's input, the agent's legacy
  prompt fields, a container's stored params. A key the block's params can name is
  `E_UNSUPPORTED_SYNTAX`. Values that never run are not written: apply restores them from the
  stored workflow.
- `extraData: { <key>: json }`, on a loop or parallel only, holds the subflow keys of
  `block.data` (`count`, `collection`, `loopType`, `whileCondition`, `doWhileCondition`,
  `parallelType`, `batchSize`) canonicalize could not read as config, which the serializer passes
  on. It is separate from `extra` because containers stored by the canvas often carry params
  under those same names. Plain JSON; any other key, or `extraData` on another block, is
  `E_UNSUPPORTED_SYNTAX`.

## Values

- Literals, objects, arrays, `-number`. `null` as a whole param means absent (no editor default
  fills it); nested `null` is kept. An omitted param is its editor default. A plain object with a
  `$sim` key is data and compiles to `{ $sim: 'literal', value }`.
- `raw(v)`: the CWM value verbatim (literals only). `$sim` objects inside are canonical nodes,
  shape-checked; a `literal` node's `value` is not inspected.
- `todo()`: absent (no editor default fills it), with `W_REQUIRED_MISSING` when the field is
  required.
- A plain string is fine where a selector is expected (`channel: 'C0123'`): it lands in the
  pair's advanced member, and apply keeps the stored selector member when that showed the id.
- Strings: `'...'`, untagged templates without `${}`, and `t`/`js`/`py`/`sh`/`json`/`md` tagged
  templates (cooked text). Interpolations: refs, `env.X`, `vars.x`, loop params, `ref('raw')`,
  string and number literals.
- Refs: `blk.a.b` → `<key.a.b>`, `blk['x-y']` → `<key.x-y>`, `blk.items[0]` → `<key.items[0]>`,
  `blk.items['0']` → `<key.items.0>`. `env.X` / `env['X']` → `{{X}}` (name must match
  `[A-Za-z_][A-Za-z0-9_]*`). `ref('Raw.path')` → `<Raw.path>`.
- `vars.x` is decided by field, and the printer and compiler share the rule. Inside a
  variables-input field (`structured: 'variables'`, at any depth of its value), a bare `vars.x` is
  the variable node `{ $sim: 'var', key }`. Everywhere else, and inside any template, it is the
  text `<variable.x>`. So the printer prints a var node bare only in such a field (elsewhere it is
  `raw({ $sim: 'var', key })`), and prints whole-string `<variable.x>` text there as
  `` t`${vars.x}` `` (elsewhere bare). Golden: `print/__golden__/vars-by-field.txt`.
- A JSON code field (subBlock type `code`) written as an object or array literal compiles to
  `JSON.stringify(value, null, 2)` (in a pair, see pair mode above).
- inputFormat (`structured: 'inputFormat'`) as a record: `name: 'string'` →
  `{ name, type: 'string', value: '' }`; `name: { type, ... }` → `{ name, type, ... }`; `{}` is the
  empty list. Arrays pass through; the printer writes a list the record cannot carry (an
  integer-like or repeated name, an unknown key) as `raw([...])`.
- Function code: `code: file('./functions/x.js')`, relative to the entry file, extension matching
  `language` (default `javascript`). JavaScript files have `$ref`/`$env` chains rewritten back
  (`src/code-files`); Python and shell are verbatim.
- Tools (`valueKind: 'tools'`): an array of `ns.tool.method(params, options?)` /
  `method.tool(params, options?)` and `raw(tool)`. Options: `operation`, `toolId`, `title`,
  `usageControl`, `usageControlExpression`, `modes`, `customTool`, `operationPolicy`, `extra`.

## Branches

- Condition builder: the params object holds the rows; a key that is a catalog field is a param
  instead. `else: true` (last row) is the empty else. Rows are strings or templates.
- Router: `routes: { key: text }`. `block('condition', ...)` uses `conditions: { ... }`.
- `{}` (or `routes: {}`) is `rows: null`; the implicit ports `if`/`else` and `route0` stay
  addressable.
- Per-row `title`/`extra` go in `meta.branches: { key: { title?, extra? } }`.
- Two or more condition rows must end with `else` (`E_BRANCH_ELSE_LAST`). A key equal to an output
  name, `to` or `onError` is `E_BRANCH_KEY_COLLIDES`.

## Containers

- `loop.for('N', { count })`, `loop.forEach('N', { collection })`,
  `loop.while('N', { condition })`, `loop.doWhile('N', { condition, count })` (a `doWhile` with no
  condition runs `count` iterations),
  `parallel.count('N', { count, batchSize })`, `parallel.collection('N', { collection, batchSize })`,
  and bare `parallel('N', { count, collection, batchSize })` (no `parallelType`).
- Third argument: `(p) => { ... }`, or `(p) => block(...)` which implies `p.to(block)`.
- The other types' stored fields have no syntax; apply keeps them from the stored workflow. A
  loop with no `count` gets 5, the count that runs. `meta.extra` carries the container's stored
  params and `meta.extraData` its unreadable subflow data (see `meta` above).
- `p.x` is `<loop.x>` / `<parallel.x>` when `p`'s container is the innermost of its kind around
  the block, else the named `<containerkey.x>`. `container.results` / `container.index` are named
  refs.

## Wiring

- `a.to(b, c)` (fan-out), chains `a.to(b).to(c)`, groups `a.to(b, c).to(d)` (fan-in),
  `a.onError(b)` (not chainable), `cond.key.to(x)`, `p.to(x)` / `p.start.to(x)`, and
  `container.to(x)` (end port).
- `edge(a, 'handle', b)`: `'source'` is the out port (how the printer writes it for a condition,
  router or container), `'loop-start-source'`/`'parallel-start-source'` the start port,
  `'loop-end-source'`/`'parallel-end-source'` the end port, anything else a raw port.
  `W_RAW_HANDLE` either way; the start/end child checks do not apply to `edge()`.

## Comments

- Before the first import, and between imports: `header`. After the export: `footer`.
- Same line after an item: trailing on it; otherwise leading on the next item; after the last
  item: `footer` in a body, trailing on the last param in a params object.
- Items: statements (`block` / `edges` anchors), params (`param`, the written name, so the
  canonical id for pairs), `extra` entries (`param`, by key), variables (`var`).
- The group above the first top-level wiring statement goes to `wiring` only when a blank line
  separates it from the statement; otherwise it goes to that statement's `edges` anchor.
- Anything inside an expression is hoisted to the enclosing anchor with `W_COMMENT_MOVED`.
- Branch rows take `param` anchors keyed by the branch key.

## Also accepted (hand-written conveniences)

- `p.start.to(x)` alongside `p.to(x)`; `env['X']`; `blk['to']` and non-call `blk.to` as refs.
- `raw([...])` for a whole tool list.
