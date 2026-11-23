# Workflow source syntax

The surface `compileWorkflow` accepts: exactly what the printer emits, plus the hand-written
conveniences under "Also accepted". `apps/sim/lib/workflows/code/goldens.test.ts` compiles every
printer golden in `print/__golden__/`, over the real catalog, with zero errors. The authoring types
are `@sim/workflow-sdk`'s `core.d.ts` plus the per-block declarations generated from the catalog.

**Source holds what executes** (DESIGN.md "Source holds what executes"). A file states every value
the serializer sends or deploy reads, the wiring, branches and the config of the loop or parallel
type in effect. Canvas-only state (which member of a basic/advanced pair shows a value, whether a
selector or typed text produced an id, inactive values, the other subflow types' fields, layout,
unknown block data) has no syntax: the printer leaves it out and apply keeps it from the stored
workflow.

**Defaults.** An omitted param is the editor default canvas creation writes, so a block written
with no params is stored as a canvas-created one. `null` as a whole param means stored-absent (no
default fills it). The printer omits a value equal to the default and writes `null` for an active
field that has a default but no stored value.

## File

```ts
// @sim-sdk 1
import { agent, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Name', { description: '…', variables: { … } }, ({ vars }) => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const answer = agent('Answer', { model: 'claude-sonnet-5-5', messages: [ … ] })
  start.to(answer)
})
```

- Line 1 is `// @sim-sdk N`. Missing: `E_SDK_HEADER`. `N` above the server's major: `E_SDK_MAJOR`.
  `N` below `OLDEST_SDK_MAJOR` (`sdk.ts`): `E_SDK_MAJOR_OLD`.
- Imports: named imports from `'@sim/workflow-sdk'` only (aliases allowed). Anything else is
  `E_UNSUPPORTED_SYNTAX`.
- Exactly one `export default workflow(name, options?, body)` (`E_WORKFLOW_EXPORT`). `options` is
  `{ description?, variables? }`; `body` is `() => { … }` or `({ vars }) => { … }`. The SDK also
  exports `vars`, the same variables untyped; the printer always writes the body parameter.
- Variables: `variables: { <key>: { name?, type, value } }`. The property key is the variable key;
  `name` is written only when it differs, and must normalize to the key
  (`E_VARIABLE_NAME_MISMATCH`). `type` is `string | number | boolean | object | array | plain`;
  `value` is plain JSON. Both are required. The stored key is the property key normalized
  (lowercased, spaces and dots removed), and `vars.<key as written>` resolves through it.
- The body holds block declarations and wiring statements. No other statements, no helpers, no
  loops, no conditionals, no imports of your own.

## Blocks

- `const x = builder('Name', params?, meta?)`, or a bare `builder(…)` statement. The builder is the
  dotted catalog path: `agent`, `slack.sendMessage`, `table.insertRow`, `trigger.gmail.poller`,
  `legacy.<path>` for hidden legacy versions. An unknown path is `E_UNKNOWN_BUILDER` with a
  did-you-mean.
- `block(type, 'Name', params?, meta?)` writes any type: unknown, legacy, custom, or a block that
  does not fit a builder. With a catalog type, params are checked against its fields; without one,
  they are kept verbatim.
- A builder prints only blocks on its own surface: a trigger-mode builder never prints an action
  block, nor an action builder a block in trigger mode (a trigger block's builders fit either). Such
  a block prints through `block()`.
- Names: a non-empty string literal (`E_NAME_NOT_LITERAL`, `E_EMPTY_NAME`), unique by key
  (`E_DUPLICATE_NAME`), not a reserved key (`loop`, `parallel`, `variable`: `E_RESERVED_NAME`). A
  name with a bidi control or zero-width character is `W_SUSPICIOUS_CHARACTER` (the workflow's own
  name too); the printer escapes such characters (U+202E prints as `\u202E`) in every string. Two
  names whose keys differ only by Unicode normalization (`café` precomposed and decomposed) are
  `E_LOOKALIKE_NAME`: the runtime binds keys by their bytes, so they would be two blocks no reader
  can tell apart. So is a name with a word that mixes Latin letters with Cyrillic, Greek, Armenian
  or Cherokee ones (`Сlaude` with a Cyrillic `С`), which reads as a Latin name it is not: Unicode's
  script property decides, without a confusables table, so a look-alike written wholly in one
  other script (`Сlаudе` is caught, `Сласде` is not mixed) and digit look-alikes are not caught. A
  pair or name the stored workflow already holds is `W_LOOKALIKE_NAME`. Keys are compared
  NFC-normalized and stored as written.
- `response(name, { body, status?, headers? })` is the response block in the editor's JSON mode:
  `body` in `data` (a literal or text), `status` as text (a number literal prints for a canonical
  integer), `headers` as header-table rows. Any other key is `E_UNKNOWN_PARAM`. The printer uses it
  only when the block carries exactly those params.

### Params

- A param is a subBlock id, or the `canonicalParamId` of a basic/advanced group (even a group of
  one). Writing a group member by its own id is `E_UNKNOWN_PARAM`, with a hint naming the right name.
  A did-you-mean covers the params visible for the chosen operation.
- A param the catalog aliases (`paramAliases`, frozen in `apps/sim/blocks/sdk-names/`:
  `oauthCredential` → `credential`) prints under its alias. Compile accepts the alias or the param name; both at once is
  `E_UNSUPPORTED_SYNTAX`.
- A pinned param (`operation`, or a builder's `fixed` entry) is `E_FIXED_PARAM`; the compiler adds
  pinned values.
- A param not visible under the block's values is `W_FIELD_NOT_APPLICABLE`, naming the value that
  hides it: it never runs, so apply keeps the stored value (preserved state) and the written-back
  source drops the line. A required field left
  empty (or `todo()`) is `W_REQUIRED_MISSING`. A value whose JSON type differs from the field's is
  `W_VALUE_KIND`; it is never coerced.

### Pair mode

The value kind alone picks the member of a basic/advanced pair; there is no `meta.modes`.

- A selector call (`credential`, `table`, `knowledgeBase`, `childWorkflow`, `skill`, `customTool`,
  `mcp`, `folder`, `file`), or a non-empty array of them, is basic. Anything else is
  advanced.
- Exception: a list or object literal never lands in a JSON code member (subBlock type `code`) when
  the other member takes it as written (`table_v2`'s `filterInput`: a list is the filter builder's,
  JSON text the code editor's). The printer writes a JSON code member's value as the text it stores,
  so both directions are unambiguous.
- A plain string where a selector is expected (`channel: 'C0123'`) lands in the advanced member.
- Every group on the block gets a mode; an unwritten group is basic. On apply the mode is canvas
  state: when the pair's value is unchanged the stored member and mode stay, and a plain id written
  where the stored block shows the selector member stays in that member.

### `meta`

| Key | Meaning |
|---|---|
| `key: '<key>'` | A legacy key the display name cannot carry (see below). |
| `disabled: true` | Stored `enabled: false`. |
| `locked: true` | Apply refuses any change to this block. |
| `errorPort: boolean` | Exposes the error port. In the model, `errorPort` is `meta.errorPort` or the block has an `onError` edge. |
| `retry: { enabled, maxTries, waitBetweenTriesMs }` | The stored `BlockRetryConfig`, written whole: `maxTries` a whole number from 2 to 5, `waitBetweenTriesMs` from 0 to 5000 (the bounds the loader pins it to); anything else is `E_UNSUPPORTED_SYNTAX`. |
| `advancedMode: boolean` | The block-level advanced toggle; it changes what serializes. |
| `triggerMode: boolean` | Runs the block as its trigger. Trigger builders set it; any other builder writes it only for a block stored in trigger mode. |
| `branches: { <key>: { title?, extra? } }` | Per condition/router row, the display title and stored row fields with no syntax. `title: null` is a row stored with no title, which the executor never takes for `else`. An `extra` field the row models (`id`, `title`, `value`, `key`) or editor state is `E_UNSUPPORTED_SYNTAX`. |
| `extra: { <subBlockId>: value }` | Stored params that run but have no SDK syntax (a schema-agnostic custom block's inputs, the agent's legacy prompt fields, a container's stored params). A key the block's params can name, or a value of `todo()`, `stored()` or `codeFile()`, is `E_UNSUPPORTED_SYNTAX`. |
| `subflowData: { <key>: json }` | Loop or parallel only: `block.data` subflow keys (`count`, `collection`, `loopType`, `whileCondition`, `doWhileCondition`, `parallelType`, `batchSize`) canonicalize could not read as config. Any other key, or on another block, is `E_UNSUPPORTED_SYNTAX`. |

`meta.key` must be a string literal. The printer writes it only for a block whose key the name
cannot produce, and the compiler accepts it only when the key is in `CompileInput.knownKeys` (the
stored workflow's keys) and has one of the two legacy shapes:

- the `~n` collision form of the normalized name (`api('agent1', {…}, { key: 'agent1~2' })` next to
  `api('Agent 1', …)`), with the plain key declared by another block;
- the normalized name itself when it is reserved (`api('Loop', {…}, { key: 'loop' })`).

Anything else is `E_KEY_OVERRIDE`, and the block falls back to its normalized name. Source can
round-trip such a block but never introduce one; renaming the block retires the override.

## Values

- Literals, objects, arrays, `-number`. Nested `null` is kept. A plain object with a `$sim` key is
  data and compiles to `{ $sim: 'literal', value }`.
- Strings: `'…'`, untagged templates without `${}`, and tagged templates (cooked text):

  | Tag | For |
  |---|---|
  | `` t`…` `` | Text with interpolations |
  | `` js`…` `` | JavaScript (condition expressions, inline function code) |
  | `` py`…` ``, `` sh`…` `` | Python and shell code |
  | `` json`…` `` | JSON text kept verbatim |
  | `` md`…` `` | Markdown (note content) |

  Interpolations: refs, `env.X`, `vars.x`, subflow params, `ref('raw')`, string and number literals.

### Resources and helpers

| Form | Compiles to |
|---|---|
| `credential('key')` | A saved credential (`credential`) |
| `table('key')` | A workspace table (`table`); the table block's operations live on `table.*` |
| `knowledgeBase('key')` | A knowledge base (`knowledge-base`) |
| `file('path')` | A workspace file (`file`); the file block's operations live on `file.*` |
| `folder('key')` | A workspace folder (`file-folder`) |
| `childWorkflow('key')` | A workflow, for `runWorkflow` and similar (`workflow`); `.asTool()` in a `tools` list |
| `customTool('key', { usageControl?, usageControlExpression? })` | A custom tool; in a `tools` list, the picker's reference |
| `mcp('key')` | An MCP server (`mcp-server`); `.tool(name)` in a `tools` list |
| `skill('key')` | A workspace skill (`skill`) |
| `codeFile('./functions/x.js')` | Function code kept in a file (see "Function code") |
| `stored()` | The stored value of this param, not shown (see below) |
| `raw(v)` | The canonical value verbatim (literals only). `$sim` objects inside are canonical nodes, shape-checked; a `literal` node's `value` is not inspected |
| `todo()` | Absent, with `W_REQUIRED_MISSING` when the field is required |
| `ref('Raw.path')` | The reference text `<Raw.path>`, verbatim |
| `env.X` | `{{X}}` |
| `block(…)`, `edge(…)` | A generic block; a raw edge (see "Wiring") |

Keys are the workspace's persisted resource keys; `.sim/sdk/workspace.d.ts` lists them. A key with
no live resource is `E_MAT_UNKNOWN_RESOURCE` on apply.

### `stored()`

The printer writes `stored()` for literal text in a `password` field (a secret is never printed;
`{{ENV}}` and references print as themselves), in params and tool params alike. It compiles to the
value `CompileInput.stored` (the stored workflow the file continues) holds for the same block key,
type and param, a pair's members and mode included. A new block, another type or an empty field is
`E_STORED_VALUE_MISSING`; inside a value it is `E_UNSUPPORTED_SYNTAX`.

A tool's `stored()` takes the value of the stored tool it continues, matched by identity: the one
stored tool of the same type and operation whose params agree with every param the source writes.
Failing that, a lone candidate wins while the list holds as many tools of that kind as stored, and
position decides while the list keeps its stored length and types. A tool no rule settles (two
candidates after the list's count or order changed) is `E_STORED_VALUE_MISSING`, so a deleted or
reordered tool never takes another tool's secret.

### References

- `blk.a.b` → `<key.a.b>`, `blk['x-y']` → `<key.x-y>`, `blk.items[0]` → `<key.items[0]>`,
  `blk.items['0']` → `<key.items.0>`. Paths are typed from the block's outputs; a path no output
  has is `W_UNKNOWN_OUTPUT_PATH` (the apply refuses it on a block the edit changed). For an agent
  with a `responseFormat`, its declared fields count beside the static outputs (skipped when the
  format holds references); for a Start, API or Input trigger its declared `inputFormat` inputs
  do, so `start.nope`, or a reference to an input since removed, is `W_OUTPUT_PATH_UNDECLARED`
  at the reference (a caller may still pass it, so it is never refused); other dynamic outputs
  skip the check. `x.error` on a block with no error edge reads nothing:
  `W_OUTPUT_PATH_UNDECLARED`.
- A ref to a block declared later is `W_FORWARD_REF`; it still resolves. A ref into a sibling
  subflow's child is `E_OUT_OF_SCOPE`. An unknown identifier is `E_UNKNOWN_IDENTIFIER` with a
  did-you-mean. Wiring resolves its identifiers the same way.
- `env.X` / `env['X']` → `{{X}}`; the name must match `[A-Za-z_][A-Za-z0-9_]*`
  (`E_INVALID_ENV_NAME`).
- `vars.x` is decided by field, and printer and compiler share the rule. Inside a variables-input
  field (`structured: 'variables'`, at any depth), a bare `vars.x` is the variable node
  `{ $sim: 'var', key }`. Everywhere else, and inside any template, it is the text `<variable.x>`.
  So a var node prints bare only in such a field (elsewhere `raw({ $sim: 'var', key })`), and
  whole-string `<variable.x>` text there prints as `` t`${vars.x}` ``. An undeclared variable is
  `E_UNKNOWN_VARIABLE`.
- Hand-written `<Name.path>` text whose head is not a normalized block key, or names no block, is
  `W_REF_NOT_NORMALIZED`, with the ident form as the hint. Such text is kept verbatim, so a rename
  never rewrites it.
- The printer keeps a stored `<x.y>` token that resolves to nothing as literal text
  (`W_UNRESOLVED_REF`).

### JSON fields

A JSON code field (subBlock type `code`: `responseFormat`, table row `data`, a response body)
written as an object or array literal compiles to `JSON.stringify(value, null, 2)` text. Each bare
reference is stored by its output type: quoted (`"<a.b>"`) when the catalog or the workflow types it
`string`, bare (`<a.b>`) otherwise, because the executor splices a string raw and any other value as
JSON. A reference nothing types is stored bare with `W_JSON_REF_UNTYPED`, which is not raised for a
Function `result` field its JavaScript returns as a non-string literal (`return { total: a + b }`),
nor, against a stored workflow, for a field the source left as stored. A template is a JSON
string, which is how a value becomes text on purpose. A resource (`table('x')`, `credential()`,
`file()`) or `raw(node)` is not data, so inside the literal it is `E_UNSUPPORTED_SYNTAX`. The printer writes a field's text back as the
literal only when serializing that literal gives the same bytes; otherwise the text prints as a
template.

### Structured fields

- inputFormat (`structured: 'inputFormat'`) as a record: `name: 'string'` →
  `{ name, type: 'string', value: '' }`; `name: { type, … }` → `{ name, type, … }`; an entry with
  no type string (`count: 5`, `count: { value: 5 }`) is refused; `{}` is the empty list. Arrays
  pass through. The printer writes a list the record cannot carry (an integer-like or repeated name,
  an unknown key) as `raw([…])`.
- Tools (`valueKind: 'tools'`): an array of
  - `ns.tool.method(params, options?)` (`slack.tool.sendMessage(…)`): an integration operation (a
    `tools`-category block's namespaced builder, outside trigger mode). Any other builder as a tool
    (`api.tool(…)`, `trigger.gmail.tool.poller(…)`) is `E_UNKNOWN_BUILDER`. Params are checked like
    a block's: one the tool type does not have is `E_UNKNOWN_PARAM`, one of another operation
    `W_FIELD_NOT_APPLICABLE`, a literal secret `W_LITERAL_SECRET`;
  - `customTool('key', options?)`: a workspace custom tool stored as the picker's reference (a
    copied definition prints as `raw`);
  - `mcp('key').tool('name', { args?, snapshot?, usageControl?, usageControlExpression? })`: one
    tool of an MCP server, stored as the picker writes it (`type: 'mcp'`, `title` = the tool name,
    params `serverId` and `toolName`). `args` are argument values the workflow fixes; they may not
    reuse `serverId`, `toolName`, `serverName` or `serverUrl`. `snapshot` is
    `{ serverName?, serverUrl?, schema? }`, what the picker saved about the server and the tool's
    input schema: shown in the editor, never run. The stored `toolId` embeds the server's id, so
    canonicalize drops it when it equals `createMcpToolId(serverId, toolName)` and materialize
    derives it again;
  - `childWorkflow('key').asTool({ usageControl?, usageControlExpression? })`: a child workflow as
    the picker adds it (`type: 'workflow_input'`, `title: 'Workflow'`,
    `toolId: 'workflow_executor'`). One with fixed inputs prints as `raw(tool)`;
  - `raw(tool)`: any other stored tool, including an MCP or child-workflow tool whose stored fields
    drifted from what the picker writes (a renamed title, a foreign `toolId`, explicit modes) and a
    tool keyed by an alias name. A password param holding literal text prints as
    `params: { key: stored() }`, resolved like a builder tool's `stored()`; `stored()` anywhere
    else in the literal is refused.

  `mcp().tool()` and `asTool()` print only when compiling them reproduces the stored tool exactly
  (`agent-tools.ts`).

  Tool params take the same aliases. Options: `operation`, `toolId`, `title`, `usageControl`,
  `usageControlExpression`, `modes` (the tool's pair modes, which pick the member the agent reads),
  `customTool`, `operationPolicy`, `extra`.

### Function code

`code: codeFile('./functions/x.js')`, relative to `workflow.ts`, with the extension matching
`language` (default `javascript`). Otherwise `E_CODE_FILE_PATH`; a file the request did not send is
`E_CODE_FILE_MISSING`. JavaScript files use `$ref.block.path` for `<block.path>` and `$env.NAME` for
`{{NAME}}`, rewritten back on compile; Python and shell files are verbatim, so they write
`<block.path>` and `{{NAME}}` themselves, and a `$ref` or `$env` in one is
`W_CODE_FILE_REF_SYNTAX` (the apply refuses it in a file the edit changed). A `<block.path>` tag in
any code file (a JavaScript string included) is checked like a `$ref` chain. `$ref` names a block by
its key (`$ref.triageagent.content`), not its ident; a chain that names no block or variable is
`W_UNRESOLVED_REF` at the file location (the hint names the key when the head is an ident or a
block name), and a path no output has is `W_UNKNOWN_OUTPUT_PATH`. When the stored code
cannot round-trip through a file, the printer writes it inline as `` js`…` `` with
`W_CODE_FILE_INLINED`.

## Branches

- Condition: the params object holds the rows, in order; a key that is a catalog field is a param
  instead. Rows are strings or templates. `else: true` (last) is the empty else.
- Router: `routes: { key: text }`. `block('condition', …)` uses `conditions: { … }`.
- `{}` (or `routes: {}`) is a never-persisted row list; the implicit ports `if`/`else` and `route0`
  stay addressable.
- Two or more condition rows must end with `else` (`E_BRANCH_ELSE_LAST`). Branch keys are unique
  (`E_DUPLICATE_BRANCH_KEY`) and may not equal an output name, `to` or `onError`
  (`E_BRANCH_KEY_COLLIDES`).
- Per-row `title`/`extra` go in `meta.branches`.

## Containers

| Form | Type |
|---|---|
| `loop.for('N', { count }, body)` | `for` |
| `loop.forEach('N', { collection }, body)` | `forEach` |
| `loop.while('N', { condition }, body)` | `while` |
| `loop.doWhile('N', { condition, count }, body)` | `doWhile`; with no condition it runs `count` times |
| `parallel.count('N', { count, batchSize }, body)` | `count` |
| `parallel.collection('N', { collection, batchSize }, body)` | `collection` |
| `parallel('N', { count, collection, batchSize }, body)` | no stored `parallelType` |

- `body` is `(p) => { … }`, or `(p) => block(…)`, which implies `p.to(block)`. `meta` is the fourth
  argument.
- A loop with no `count` gets 5, the count that runs. The other types' stored fields have no
  syntax; apply keeps them.
- A `count` that is not a whole number of at least 1, or a `batchSize` outside 1–20, is
  `W_SUBFLOW_COUNT`: the runtime replaces or clamps it. It compiles as written, so a stored value
  round-trips.
- `p.index`, `p.currentItem`, `p.items` (`E_UNKNOWN_SUBFLOW_PROPERTY` for anything else) are
  `<loop.x>` / `<parallel.x>` when `p`'s container is the innermost of its kind around the block,
  else `<containerkey.x>`. `container.results` and `container.index` are named refs.

## Wiring

| Form | Edge |
|---|---|
| `a.to(b, c)` | `a` → `b` and `a` → `c` (fan-out) |
| `a.to(b).to(c)` | a chain |
| `a.to(b, c).to(d)` | `b` → `d` and `c` → `d` (fan-in) |
| `a.onError(b)` | the error port; not chainable |
| `cond.key.to(x)` | a condition or router branch |
| `p.to(x)` | a subflow's start port, inside its body |
| `container.to(x)` | the port taken after the container finishes |
| `edge(a, 'handle', b)` | a raw handle (`W_RAW_HANDLE`) |

`edge()` reads a handle as canonicalize reads a stored one: `'source'` is the out port (how the
printer writes it for a condition, router or container), `'error'` the error port, and a loop's
`'loop-start-source'`/`'loop-end-source'` (a parallel's `'parallel-…'`) its start and end ports.
Anything else stays a raw port, a subflow handle on another kind of block included. The start and
end child checks do not apply to `edge()`. The printer writes an `edge()` into a container's child
inside the container's callback, where both names are visible. A stored container edge whose
handle does not match where its target sits (a start edge to a block outside the container,
which the executor runs as the exit, or an end edge into its own child) prints as `edge()` with its
stored handle and compiles with `W_SUBFLOW_HANDLE_SCOPE`.

Refused: `.to()` on a condition or router (`E_NO_DEFAULT_OUTPUT`), an unknown branch
(`E_UNKNOWN_BRANCH`), an edge into a trigger (`E_TARGET_TRIGGER`), `onError` on a block with no
error port (`E_ERROR_PORT_UNSUPPORTED`), an edge to or from a note (`E_EDGE_NOTE`), an edge across
subflow scopes (`E_EDGE_SCOPE`) and a repeated edge (`E_DUPLICATE_EDGE`).

## Comments

- Before the first import and between imports: `header`. After the export: `footer`.
- On the same line after an item: trailing on it. Otherwise: leading on the next item. After the
  last item: `footer` in a body, trailing on the last param in a params object.
- Items: statements (`block` / `edges` anchors), params (`param`, the written name, so the canonical
  id for pairs), `extra` entries (`param`, by key), branch rows (`param`, by branch key), variables
  (`var`).
- The group above the first top-level wiring statement goes to `wiring` only when a blank line
  separates it; otherwise it goes to that statement's `edges` anchor.
- A comment inside an expression is hoisted to the enclosing anchor (`W_COMMENT_MOVED`). A comment
  whose block no longer exists is dropped (`W_COMMENT_DROPPED`).

## Also accepted (hand-written conveniences)

- `env['X']`; `blk['to']` and non-call `blk.to` as refs.
- `raw([…])` for a whole tool list.
- `p.start.to(x)` is not accepted: write `p.to(x)`.

## Diagnostics

Errors refuse the whole apply. Warnings are saved as written; info is informational.
`diagnostics/codes.ts` is the source of truth.

**Compile and print**

| Code | Meaning |
|---|---|
| `E_SYNTAX` | Babel could not parse the file. |
| `E_INVALID_CHARACTER` | A NUL or an unpaired UTF-16 surrogate, raw or escaped in a string, in the file or a code file: a workflow cannot store either. |
| `E_NUMBER_NOT_FINITE` | A number literal too large to store (`1e999` reads as `Infinity`). |
| `W_NUMBER_PRECISION` | A number literal whose digits a number cannot hold; write it as a string. |
| `E_SDK_HEADER` | Line 1 is not `// @sim-sdk N`. |
| `E_SDK_MAJOR` | The header's major is newer than the server supports. |
| `E_SDK_MAJOR_OLD` | The header's major is older than the oldest the server reads. |
| `E_UNSUPPORTED_SYNTAX` | A construct outside this grammar; the hint names the supported form. |
| `E_WORKFLOW_EXPORT` | Not exactly one `export default workflow(…)`. |
| `E_LIMIT_EXCEEDED` | Over the block, edge, total-byte, depth or `codeFile()` reference cap (`SOURCE_LIMITS`). Apply answers 413. |
| `E_TOO_MANY_ERRORS` | The compile stopped after 100 errors; fix those and compile again to see the rest. |
| `I_FINDINGS_TRUNCATED` | 100 warnings, or 20 of one code, were listed and the rest omitted, so a flood of one finding never hides another. A finding repeated at the same place is listed once. Infos are capped apart (100, the rest dropped), so they never displace a warning, and errors are never displaced by either. An answer that merges findings from several stages is capped the same way as a whole; when that cuts it, it ends in one `I_FINDINGS_TRUNCATED` counting what it left out, in place of the stages' own. |
| `E_DUPLICATE_NAME` | Two blocks normalize to one key. |
| `E_RESERVED_NAME` | A block name normalizes to `loop`, `parallel` or `variable`. |
| `E_KEY_OVERRIDE` | A `meta.key` that is not a legacy key the stored workflow already has. |
| `E_EMPTY_NAME` | An empty block name. |
| `E_NAME_NOT_LITERAL` | A block or workflow name that is not a string literal. |
| `E_LOOKALIKE_NAME` | Two block names whose keys differ only by Unicode normalization (NFC vs NFD), or a block name with a word that mixes Latin letters with Cyrillic, Greek, Armenian or Cherokee ones (`Сlaude`); the message names the code point. |
| `W_LOOKALIKE_NAME` | A look-alike pair the stored workflow already holds, kept so it round-trips. |
| `W_SUSPICIOUS_CHARACTER` | A block or workflow name holds a bidi control or zero-width character. |
| `E_UNKNOWN_IDENTIFIER` | An identifier that names nothing in scope; the hint has a did-you-mean, says to write the value for a const refused for holding one, and points `process.env` at `env.NAME`. |
| `E_OUT_OF_SCOPE` | A ref or wiring into a sibling subflow's child. |
| `E_UNKNOWN_VARIABLE` | `vars.x` names no declared variable. |
| `E_DUPLICATE_VARIABLE` | Two variables with one key. |
| `E_VARIABLE_NAME_MISMATCH` | A variable's `name` does not normalize to its key. |
| `E_INVALID_ENV_NAME` | `env.X` with an invalid name. |
| `W_ENV_UNKNOWN` | `env.X`, or a code file `$env`, naming a variable the workspace does not hold (checked only when the env names are known); the hint has a did-you-mean. An offline check in a workspace directory knows only the names `secrets.ts` declares, so there the finding says `secrets.ts` does not declare it, and the hint points there. |
| `W_CHILD_INPUT_UNKNOWN` | A child workflow call's `inputMapping` sets an input the child's Start trigger does not declare (`sim workspaces source check`, with the child in the same directory); the hint names the nearest input. |
| `W_CHILD_NO_START` | A child workflow call names a workflow of the same directory that has no Start trigger (`sim workspaces source check`). |
| `W_CHILD_RESULT_PATH` | A reference to a child workflow call's `result.<key>` whose child (in the same directory) ends at a Response block on every run, where `<key>` is not `data`, `status` or `headers`: the child's result is its Response output, so the path reads nothing (`sim workspaces source check`); the hint names `result.data.<key>`. The dry run reports the same reference as a `W_APPLY_LINT` warning. |
| `E_UNKNOWN_SUBFLOW_PROPERTY` | `p.<prop>` that a loop or parallel does not have. |
| `W_FORWARD_REF` | A ref to a block declared later; it resolves. |
| `W_REF_NOT_NORMALIZED` | Hand-written `<Name.path>` text that is not in key form. |
| `E_REF_UNREPRESENTABLE` | A reference to a block whose key holds a character a reference cannot carry (`Q&A`, `x>y`); rename the block. |
| `E_EDGE_SCOPE` | An edge across subflow scopes. |
| `E_EDGE_NOTE` | An edge to or from a note. |
| `E_TARGET_TRIGGER` | An edge into a trigger. |
| `E_NO_DEFAULT_OUTPUT` | `.to()` on a condition or router; wire a branch. |
| `E_DUPLICATE_EDGE` | The same edge twice. |
| `E_ERROR_PORT_UNSUPPORTED` | `onError` on a block with no error port. |
| `W_ERROR_PORT_STORED` | `onError` on a block with no error port (a loop or parallel) that the stored workflow already wires; kept so it round-trips. An offline check, which cannot read the stored workflow, reports it for any such edge between two blocks the lock binds: an apply keeps it only if the stored workflow holds it. |
| `E_UNKNOWN_BRANCH` | `x.key.to()` where `key` is not a branch of `x`. |
| `E_DUPLICATE_BRANCH_KEY` | Two rows with one key. |
| `E_BRANCH_KEY_COLLIDES` | A branch key equal to an output name, `to` or `onError`. |
| `E_BRANCH_ELSE_LAST` | Two or more condition rows that do not end with `else`. |
| `W_RAW_HANDLE` | `edge()` with a handle kept verbatim. |
| `W_SUBFLOW_HANDLE_SCOPE` | `edge()` from a loop or parallel's start handle to a block outside it (the executor runs it as the container's exit), or from another of its handles into its own child. The canvas never draws one; stored ones print this way so they round-trip. |
| `E_EDGE_CYCLE` | Wiring that closes a cycle among enabled blocks, a self-loop included: no block on it ever runs. Framed at the edge back to a block declared earlier, the one to remove; repeat work with `loop()`/`parallel()`. |
| `W_EDGE_CYCLE` | A cycle the stored workflow already holds, kept so it round-trips; none of it runs. An offline check reports it for a cycle among blocks the lock binds, which an apply keeps only if the stored workflow holds every edge of it. |
| `W_BRANCH_UNWIRED` | A condition or router branch no edge leaves, so a run that takes it ends there; the hint names the wiring. Not reported for a branch the stored workflow already leaves unwired. |
| `E_UNKNOWN_BUILDER` | A builder path the catalog does not have, a bare builder-shaped call (`apii('Name', …)`) nothing binds, or a namespace the SDK lacks or the file did not import; `hint` names the builder a common other name stands for (`http.request` → `api`), then prefers a synonymous verb (`postMessage` → `sendMessage`), then the closest path, then the namespace's builders. |
| `E_UNKNOWN_PARAM` | A param the block does not have; the hint has a did-you-mean, or for block meta written there (`retry`, `disabled`, `locked`, `errorPort`) the third argument that takes it. |
| `E_FIXED_PARAM` | A param the builder already pins. |
| `W_FIELD_NOT_APPLICABLE` | A param not visible under the block's values; apply keeps the stored value and the written-back source drops it. |
| `W_REQUIRED_MISSING` | A required field left empty, including `todo()`; not repeated for a field an `E_UNKNOWN_PARAM` did-you-mean names, or one written with a value that failed to compile. |
| `W_UNKNOWN_OPTION` | A dropdown value none of its options names; `hint` lists them. |
| `E_UNKNOWN_OPERATION` | An `operation` the block does not offer; `hint` lists them. A retired one the stored block holds is `W_UNKNOWN_OPTION`. |
| `W_UNKNOWN_MODEL` | A `model` the catalog does not list (kept: custom models are free text). |
| `W_LEGACY_BLOCK_TYPE` | A new block of a legacy or deprecated type; `hint` names the replacement's builders. |
| `I_SCHEDULE_UTC` | A schedule created from source with no `timezone`, which runs in UTC (the editor would have seeded the viewer's zone). |
| `E_STORED_VALUE_MISSING` | `stored()` where the stored workflow holds no value. |
| `W_VALUE_KIND` | A value whose JSON type differs from the field's. |
| `W_OUT_OF_RANGE` | A literal slider value outside the catalog `min`/`max`, off its `step`, or fractional where it takes whole numbers; kept as written, and the executor forwards it unclamped. |
| `W_TABLE_FILTER_SHAPE` | A literal table filter the runtime refuses: the legacy `$` operator grammar, or predicate and builder rows mixed. |
| `W_LITERAL_SECRET` | A password field (an API key, a token) holding literal text instead of an env reference, or any field holding a detected credential (a token format, an `Authorization` header, a credential-named property or query parameter); get prints it as `stored()`. For a literal token in a credential field, the hint says `credential('<key>')`. |
| `W_SUBFLOW_COUNT` | A loop or parallel count, or a parallel batch size, the runtime replaces or clamps. |
| `W_UNKNOWN_OUTPUT_PATH` | A ref path the block's outputs do not have; the hint has a did-you-mean or lists the outputs. |
| `W_OUTPUT_PATH_UNDECLARED` | A path the block does not declare that the run still accepts: an undeclared `inputFormat` input, or `x.error` with no error edge. Never refused. |
| `W_JSON_REF_UNTYPED` | A bare ref in a JSON literal whose type nothing declares. |
| `W_LOOP_CONDITION_SYNTAX` | A while or do-while condition that is not a JavaScript expression once each reference stands in as a value, as the run evaluates it (`return Boolean(<condition>)`): the run fails there. Refused as `E_APPLY_LOOP_CONDITION_SYNTAX` on a loop the edit added or changed. A loop reading its own `index` (or `currentItem`, `items`) by its name in its condition is `W_REF_OUT_OF_SCOPE`: the condition is evaluated outside the loop's body, so only `<loop.index>` reads the iteration there. |
| `W_REF_OUT_OF_SCOPE` | A loop or parallel iteration field (`index`, `currentItem`, `items`) read from a block outside that container: `lp.index` after the loop, `$ref.loop.index` or `<loop.index>` in a block in no loop. The run fails (or reads nothing) there. Refused as `E_APPLY_REF_OUT_OF_SCOPE` on a block the edit changed. |
| `W_UNKNOWN_BLOCK_TYPE` | A new block of a type the catalog does not hold; refused as `E_APPLY_INVALID_BLOCK_TYPE`. A block the stored workflow or the lock already holds keeps its type quietly. |
| `W_TYPE_NOT_ADDABLE` | A new block of a type the catalog keeps only for blocks already using it; refused as `E_APPLY_TYPE_NOT_ADDABLE`. |
| `E_CODE_FILE_MISSING` | `codeFile()` names a file the request did not send. |
| `E_CODE_FILE_PATH` | A code file path outside the directory, or with the wrong extension. |
| `W_CODE_FILE_INLINED` | Print: the code could not round-trip through a file and was inlined. |
| `W_CODE_FILE_REF_SYNTAX` | `$ref.key.path` or `$env.NAME` in a Python or shell code file, which runs as text; the hint names the `<key.path>` or `{{NAME}}` form. Refused as `E_APPLY_CODE_FILE_REF_SYNTAX` in a file the edit changed. |
| `W_UNRESOLVED_REF` | Print: a stored `<x.y>` token that resolves to nothing. Compile: a code file `$ref` chain that does. Either is kept as text. |
| `W_FORWARD_REF_LITERALIZED` | Print: a ref in a cycle printed as text. |
| `W_COMMENT_MOVED` | A comment hoisted to the nearest anchor. |
| `W_COMMENT_DROPPED` | A comment whose block no longer exists. |

**Lock and source meta** (`.sim/lock.json`, stored `workflow_source_meta`; reported with a JSON
`path`)

| Code | Meaning |
|---|---|
| `E_LOCK_JSON`, `E_SOURCE_META_JSON` | Not valid JSON. |
| `E_LOCK_VERSION`, `E_SOURCE_META_VERSION` | `version` missing or not `1`. |
| `E_LOCK_SHAPE`, `E_SOURCE_META_SHAPE` | A required field missing or of the wrong type or format. |
| `E_LOCK_UNKNOWN_FIELD`, `E_SOURCE_META_UNKNOWN_FIELD` | A field the schema does not define (`x-` keys are allowed). |
| `E_LOCK_KEY` | A block or variable key not in normalized form. |
| `E_LOCK_IDENT`, `E_SOURCE_META_IDENT` | An ident that is not a JS identifier, or is reserved. |
| `E_LOCK_DUPLICATE_IDENT`, `E_SOURCE_META_DUPLICATE_IDENT` | Two blocks with one ident. |
| `E_LOCK_DUPLICATE_ID` | One block, variable or branch id under two keys. |
| `E_LOCK_PARENT` | A parent naming no block, itself, or forming a cycle. |
| `E_LOCK_BRANCH` | A branch key that is not a JS identifier. |
| `E_LOCK_CODE_FILE_PATH` | A `codeFile` that is absolute, escapes the directory, or uses backslashes. |
| `E_SOURCE_META_ANCHOR` | A comment key that is not a valid anchor. |

**Canonicalize** (reading the stored workflow; returned by `source get`)

| Code | Meaning |
|---|---|
| `E_CANON_LEGACY_NAME_COLLISION` | Two stored names normalize alike; the loser is keyed `key~n`. |
| `E_CANON_EDGE_SCOPE` | A stored edge crosses subflow scopes. |
| `W_CANON_RESERVED_NAME` | A stored name normalizes to a reserved key. |
| `W_CANON_DANGLING_EDGE` | A stored edge to a missing block; dropped. |
| `W_CANON_DANGLING_PARENT` | A parent that does not exist; the block is placed at the root and the raw parent kept. |
| `W_CANON_RAW_HANDLE` | An unknown edge handle, kept as a raw port. |
| `W_CANON_UNKNOWN_BLOCK_TYPE` | A type the catalog does not have; params kept. |
| `W_CANON_UNRESOLVED_ID` | A resource id with no key; kept verbatim. |
| `W_CANON_TITLE_OVERRIDE` | A branch title that differs from its positional title. |
| `W_CANON_SUBFLOW_REPAIRED` | A loop or parallel config the loader would repair. |
| `W_CANON_SUBBLOCK_TYPE_DRIFT` | A stored subBlock type differs from the catalog's. |
| `W_CANON_UNDECODABLE_JSON` | A stored JSON-text field that does not parse, kept as text; or a branch list that is not rows with distinct ids, kept verbatim. |

**Materialize** (binding the compiled workflow to stored ids)

| Code | Meaning |
|---|---|
| `E_MAT_DUPLICATE_LOCK_ID` | Two lock keys carry one block id. |
| `E_MAT_UNKNOWN_RESOURCE` | A resource key with no live resource in this workspace. |
| `E_MAT_UNKNOWN_VARIABLE` | A `vars.x` reference to a variable the workflow does not declare. |
| `W_MAT_DELETED_SINCE_PULL` | A lock entry whose block was deleted since the read; re-created. |
| `W_MAT_INFERRED_RENAME` | A rename inferred from type, parent and edges (the key and the ident both changed). |
| `W_MAT_RETYPE_RECREATED` | A key kept with a new type: delete plus create, so webhook URLs and schedules change. |
| `W_MAT_LOCK_ID_CLAIMED` | A lock id another workflow holds, ignored: the block binds to the stored block it matches, or gets a new id. |
| `I_MAT_NEEDS_LAYOUT` | A new block with no position, or one moved into or out of a loop or parallel; placed by autolayout. |

**Apply**

| Code | Meaning |
|---|---|
| `E_APPLY_STALE` | The workflow changed since the source was read (HTTP 409). |
| `E_APPLY_WORKFLOW_MISMATCH` | `base.workflowId` names another workflow (HTTP 400). |
| `E_APPLY_LOCKED_BLOCK` | The change touches a locked block or a child of a locked container. |
| `E_APPLY_TYPE_NOT_ADDABLE` | A new block of a type that may stay but not be added. |
| `E_APPLY_INVALID_STATE` | The resulting graph fails validation. |
| `E_APPLY_BLOCK_NOT_FOUND`, `E_APPLY_INVALID_BLOCK_TYPE` | A block or type the engine cannot place. |
| `E_APPLY_BLOCK_NOT_ALLOWED`, `E_APPLY_MODEL_NOT_ALLOWED`, `E_APPLY_TOOL_NOT_ALLOWED` | Refused by the workspace's permission group. |
| `E_APPLY_INVALID_EDGE_SOURCE`, `E_APPLY_INVALID_EDGE_SCOPE`, `E_APPLY_INVALID_SOURCE_HANDLE`, `E_APPLY_INVALID_TARGET_HANDLE` | An edge the engine refuses. |
| `E_APPLY_INVALID_SUBBLOCK_FIELD`, `E_APPLY_MISSING_REQUIRED_PARAMS` | A field the engine refuses, or required params missing. |
| `E_APPLY_RETRY_NOT_SUPPORTED` | A new or changed retry policy on a block that always runs once (triggers, human-in-the-loop, containers). |
| `E_APPLY_DUPLICATE_TRIGGER`, `E_APPLY_DUPLICATE_SINGLE_INSTANCE_BLOCK` | A second trigger or single-instance block. |
| `E_APPLY_DISABLED_ANCESTOR` | An enabled block inside a disabled container. |
| `E_APPLY_CREDENTIAL_UNREACHABLE` | A credential the acting user cannot use. |
| `W_APPLY_CREDENTIAL_KEPT` | A credential key the caller cannot resolve stands where the workflow stores a credential the caller cannot see; the stored one is kept, whatever the key. |
| `E_APPLY_SANDBOX_PLAN_REQUIRED` | The sandbox needs a plan the workspace does not have. |
| `W_APPLY_HOSTED_KEY_DROPPED` | A hosted key that does not apply was cleared. |
| `W_APPLY_VALUE_NORMALIZED` | Validation rewrote a value; the returned files show it. |
| `W_APPLY_TYPE_CHANGED` | A block's type changed; its id, webhook URL and schedules are replaced. |
| `W_APPLY_TRIGGER_REMOVED` | A deleted or retyped block still serves a live webhook, schedule, chat output or MCP tool until the next deploy. |
| `W_APPLY_CATALOG_MOVED` | Compile failed and the block catalog changed since the read: get the source again. |
| `E_APPLY_LINT`, `W_APPLY_LINT` | A workflow lint finding, mapped to a source line. |
| `E_APPLY_UNRESOLVED_REF` | A `$ref` naming no block or variable, or a path no output has, in code or a block the edit changed (`W_UNRESOLVED_REF`, `W_UNKNOWN_OUTPUT_PATH` elsewhere). |
| `E_APPLY_REF_OUT_OF_SCOPE` | A `W_REF_OUT_OF_SCOPE` iteration reference on a block the edit added, changed or moved. |
| `E_APPLY_CODE_FILE_REF_SYNTAX` | A `W_CODE_FILE_REF_SYNTAX` in a code file the edit changed. |
| `E_APPLY_LOOP_CONDITION_SYNTAX` | A `W_LOOP_CONDITION_SYNTAX` on a loop the edit added or changed. |
| `E_APPLY_BLOCK_DELETE` | The apply deletes blocks the source no longer declares; pass `--allow-delete`. When it also adds blocks of a deleted one's type, it names them as possible renames and says how to keep the ids. |
| `E_APPLY_VARIABLE_DELETE` | The apply removes workflow variables the source no longer declares; pass `--allow-delete`, as for blocks. |
| `W_APPLY_PROBABLE_RENAME` | With `--allow-delete`, a deleted block and an added one share a type and parent: a probable rename that gets a new id. |
| `E_NAME_TAKEN` | The `workflow('…')` name renames the workflow to one another workflow in its folder holds. |
| `E_WORKFLOW_META_INVALID` | The `workflow('…')` name is empty or over 255 characters, or its description is over 50,000 characters: limits the workflow API holds every workflow to. |
| `E_APPLY_INVALID_SCHEDULE` | An added or changed schedule whose cron, timezone or interval deploy would refuse. |
| `W_TABLE_UNKNOWN_COLUMN` | A table row write whose data names a key that is not a column of the table; the run drops it. The hint names the nearest column. |
