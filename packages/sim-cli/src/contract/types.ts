import type { V2OperationName } from '../generated/v2-api'

/**
 * The CLI contract: how the terminal surface maps onto the v2 API.
 *
 * Most of a command is derivable and is NOT stated here. Method, path, path
 * params, field types, enum values, defaults, and required-ness all come from
 * the generated operation table, which comes from the Zod route contracts. The
 * command name itself usually derives from `<resource> <sub-resource> <verb>`.
 *
 * This file carries only what a schema cannot say:
 *
 * - `command` — when the derived name collides or reads badly. REST overloads
 *   one path for single and bulk (`DELETE /rows` vs `DELETE /rows/[rowId]`), so
 *   those need a human to pick `delete` vs `batch-delete`.
 * - `flags` — when a field's *type* misdescribes its *meaning*. `workflowIds`
 *   is `z.string()` that the route splits on commas; nothing in the schema says
 *   "list". Also friendlier aliases (`conflictTarget` → `--on`).
 * - `pathFlags` — when a parent path segment is command context rather than the
 *   resource being acted on (`workflows runs get <runId> --workflow <id>`).
 * - `pathArgumentNames` — when a route's generic `[id]` needs a clearer CLI
 *   placeholder (`<knowledgeBaseId>`).
 * - `profileWorkspacePath` — when `[workspaceId]` is the active profile target,
 *   not a resource argument (`workspaces get`).
 * - `columns` — which of a response's fields belong in a table. Editorial.
 * - `confirm` — which operations are destructive enough to demand `--yes`.
 *
 * An operation with nothing unusual needs no entry at all.
 */

/** How one request field is exposed as a flag. */
export interface FlagSpec {
  /** Flag name, kebab-case, without `--`. Defaults to the kebab-cased field name. */
  name?: string
  /** Short alias, e.g. `w` for `--workspace`. */
  short?: string
  /**
   * Flag names this field used to answer to, such as `predicate` before the
   * count command's filter was spelled the same as its six siblings'.
   *
   * Kept only so an existing script does not break: hidden from help and from
   * the generated docs, warns on stderr, and refuses when combined with the
   * current spelling rather than silently picking one.
   */
  renamedFrom?: readonly string[]
  /**
   * Accept one or more space-separated values, or `@path` / `@-` with one
   * value per line.
   *
   * Only says that several values are allowed — how they reach the wire is
   * decided by the field's kind, not here. A `string` field is one the route
   * splits on commas (`workflowIds`), so the values are joined; anything else
   * genuinely wants an array (`rowIds`, `knowledgeBaseIds`). Conflating the two
   * turned multi-value `--kb` and `--row` into a single bogus value.
   *
   * Still needed on the string case because "this string is really a list" is
   * invisible to any type-driven generator.
   */
  list?: boolean
  /**
   * The list's natural source is a manifest file, so `@path` / `@-` skip blank
   * lines and `#` comments instead of refusing them.
   *
   * The shared reader treats a blank line as a typo, which is right for an id
   * list. A dependency list is pasted from a requirements file or a lockfile,
   * where blank lines and comments are how people structure it, and the API
   * already ignores both — the terminal was the only surface that refused
   * them. Inline argv values are untouched: an empty argument is still an
   * error, and a literal `#` value can still be passed.
   */
  manifest?: true
  /** Take a JSON string. Implied for object/array/unknown fields. */
  json?: boolean
  /**
   * Accept a plain whole number and send the route's `{ type: 'rows', max: n }`.
   *
   * A deliberate one-off for `tables dispatches create --max-rows`: the only
   * request field in the CLI whose object shape holds exactly one free value,
   * because its `type` is a `z.literal('rows')`. Left as JSON, the flag made a
   * caller type `{"type":"rows","max":100}` — four tokens of ceremony to say
   * `100`, in a shape nothing in the terminal spells out. Not a general
   * value-transform hook: no second field wants one, and a second one arriving
   * is the point at which this should become one.
   */
  rowCap?: true
  /** Overrides the help text otherwise taken from the OpenAPI description. */
  describe?: string
  /**
   * Value sent when the caller passes nothing, in place of the server's default.
   *
   * For a command whose declared `columns` read a field the API only sends at a
   * heavier setting: `logs list` shows `workflow.name`, which `details=basic`
   * omits, so the primary debugging table had a permanently empty column. It is
   * a request default, not a flag default — whatever the caller types wins,
   * including a deliberate `--details basic`.
   */
  requestDefault?: string
  /** Accepted values when the generated descriptor cannot recover an enum. */
  choices?: readonly string[]
  /**
   * Expose a string-backed API boolean as a conventional terminal toggle.
   *
   * A toggle declared here carries no generated `--no-<name>` twin by default,
   * because sending false is usually either meaningless — the server already
   * defaults the field to false — or rejected outright, as on a field the API
   * declares as `z.literal(true)`. {@link negatable} asks for the twin back on
   * the one kind of field where false is a real request.
   */
  boolean?: true
  /**
   * Give a {@link boolean} toggle its `--no-<name>` twin after all.
   *
   * Withholding the twin is right for a one-way switch: most string-backed
   * toggles sit on a field the server already defaults to false, so a negation
   * would only restate the default, and on a `z.literal(true)` field it would
   * send a request the route rejects. `files list --recursive` is neither — the
   * API turns it on by itself as soon as a search is set, so without a spelling
   * for false there is no way to search one folder without descending into it.
   * Declared per flag rather than derived from the union's false spellings,
   * which every one of these toggles publishes whether or not sending one means
   * anything.
   */
  negatable?: true
  /**
   * This field carries a folder path, so percent-encode each of its segments.
   *
   * The API's canonical folder path is percent-encoded per segment, which made
   * the terminal the only place a folder had to be spelled `/Folder%201`
   * instead of the `/Folder 1` shown everywhere else; typing what you see was
   * rejected with a message that never mentioned encoding. Marked rather than
   * inferred from the field's name: `files upload` and `knowledge documents
   * upload` take a `path` that is a LOCAL file, and encoding one of those would
   * break the read.
   */
  folderPath?: true
  /**
   * Never expose this field as a flag, and never send it.
   *
   * For request fields the terminal cannot honor — `stream: true` switches the
   * response to SSE, which the JSON client would try to `JSON.parse`. Offering
   * the flag would advertise a mode that breaks; a bespoke streaming command
   * owns that instead.
   */
  omit?: boolean
  /** Accept and send this generated field, but hide its low-level flag from help. */
  hidden?: boolean
}

/** How a route path parameter is exposed as a required named option. */
export interface PathFlagSpec {
  /** Flag name, kebab-case, without `--`. Defaults to the kebab-cased path parameter. */
  name?: string
  /** Help placeholder without angle brackets. Defaults to `value`. */
  placeholder?: string
  /** Short alias, e.g. `k` for `--kb`. */
  short?: string
  /** One-line help for the scope selected by this path parameter. */
  describe?: string
}

/** A column in table-mode output. */
export interface ColumnSpec {
  /** Header, and the default path into the row when `value` is omitted. */
  header: string
  /** Dot path into the row. Defaults to `header`. */
  path?: string
  /**
   * Narrowest this column may lock to when a renderer fixes its widths before
   * it has seen the rows.
   *
   * `logs list` sizes every column from the page it is about to print, so it
   * never needs this. A follow cannot: it locks the widths on its first batch so
   * the stream reads as one table, and `logs follow -n 0` locks them on no rows
   * at all — every column collapsed to its header label, and a run id printed as
   * `9f…`. The floor is what the column's own rendering is known to need (a
   * timestamp is 19 characters, a run id 36), so it is stated here beside the
   * `format` that produces it rather than guessed by the renderer. Capped by the
   * renderer's own maximum cell width; a floor above that is a spec bug.
   */
  minWidth?: number
  /**
   * Rendering hint; `auto` inspects the value.
   *
   * `folder-path` is the display half of `FlagSpec.folderPath`: it undoes the
   * wire encoding for the human formats, so a folder no longer prints as
   * `/cli-test-a/nested%20one` in the same row as the `nested one` the server
   * put in the adjacent name column.
   *
   * `score` fixes a similarity to four decimals. The raw double arrives as
   * `0.2818957269585687`, a nineteen-character column whose last dozen digits
   * cannot separate one result from another.
   */
  format?:
    | 'auto'
    | 'timestamp'
    | 'bytes'
    | 'duration'
    | 'bool'
    | 'cost'
    | 'count'
    | 'trace-count'
    | 'folder-path'
    | 'score'
}

export interface BodyVariantSpec {
  /** User-facing flag name, without `--`. */
  name: string
  /** Request-body property populated by this variant. */
  property: string
  /** JSON shape accepted by this variant. */
  kind: 'object' | 'array'
  /** One-line help describing when to use this variant. */
  describe: string
}

export interface CommandVariantSpec {
  /** Full alternate command path, such as `workflows mv`. */
  command: string
  /** Request fields exposed as required positional arguments. */
  positionals?: readonly string[]
  /** Request fields available on this narrower command surface. */
  requestFields?: readonly string[]
  /** One-line help for the alternate command. */
  describe?: string
}

export interface CommandSpec {
  /**
   * Command path, space-separated. Omit to accept the derived
   * `<resource> [sub-resource] <verb>` name.
   */
  command?: string
  /** Run this operation when its top-level group is invoked without a subcommand. */
  groupDefault?: boolean
  /** Alternate leaf command names, such as `ls` for `list`. */
  aliases?: readonly string[]
  /**
   * Full command paths this operation used to answer to, such as
   * `tables count create` before it became `tables rows count`.
   *
   * Unlike {@link aliases}, these are kept only so an existing script does not
   * break: each is hidden from help and from the generated docs, and warns on
   * stderr with the current spelling. Give the whole path, because a rename can
   * move a command between groups rather than just retitle its leaf.
   */
  renamedFrom?: readonly string[]
  /** Route path parameters exposed as required named options instead of positionals. */
  pathFlags?: Record<string, PathFlagSpec>
  /** Friendly placeholders for route path parameters that remain positional. */
  pathArgumentNames?: Record<string, string>
  /** Fill a `[workspaceId]` route segment from the active profile instead of an argument. */
  profileWorkspacePath?: boolean
  /** Request fields exposed as required positional arguments, in order. */
  positionals?: readonly string[]
  /** Restrict this command to these request fields; profile fields remain implicit. */
  requestFields?: readonly string[]
  /** Additional command shapes backed by the same API operation. */
  variants?: readonly CommandVariantSpec[]
  /** One-line help. Falls back to the OpenAPI summary for the operation. */
  describe?: string
  /** Per-field flag overrides, keyed by the contract's field name. */
  flags?: Record<string, FlagSpec>
  /** Friendly mutually-exclusive flags for an otherwise opaque union body. */
  bodyVariants?: readonly BodyVariantSpec[]
  /** Columns for table output. Omit on non-list commands to print a record. */
  columns?: ColumnSpec[]
  /** Fields shown for a single record in human formats. Machine output stays raw. */
  fields?: ColumnSpec[]
  /** Add `--trace` to expand recursive trace spans in human-readable output. */
  expandedTrace?: boolean
  /** Dot path to a nested result array rendered as the command's human list. */
  itemsPath?: string
  /**
   * A page-envelope field that qualifies the whole list, stated once for the
   * human formats.
   *
   * `billing logs` answers a different question depending on the credential —
   * an OAuth login or personal key sees the caller's own events, while a
   * workspace key sees the whole workspace ledger. The response says which. The value
   * belongs to the query rather than to any row, so it is not a column; it goes
   * to stderr so that a `--output text` consumer cutting tab-separated fields
   * still reads only rows. `json` and `yaml` print the unwrapped `data` array
   * and so drop the field too, which is why the note is not limited to the
   * human formats — see `runtime/result`.
   */
  pageNote?: { path: string; label: string }
  /** Allow an optional workspaceId field to omit the configured workspace filter. */
  allWorkspaces?: boolean
  /**
   * Require `--yes`. The message should say what is about to be destroyed —
   * the point is that the caller can tell whether they meant it.
   */
  confirm?: string
  /**
   * Discover table columns from inside this nested field as well as from the
   * row's own scalars.
   *
   * For rows whose real content sits in a wrapper the server chose — a table
   * row's user-defined cells live under `data` — the inferred columns would
   * otherwise be `id` and two timestamps, because a nested object cannot be a
   * column. Only meaningful when `columns` is absent.
   */
  expand?: string
  /**
   * The response IS a document, not a record to look at.
   *
   * `workflows export` exists to be redirected into a file and fed back to
   * `import`, so a key/value view of it is wrong at any fidelity — the useful
   * artifact is the payload itself. Document commands emit raw JSON (or YAML
   * when the profile says so) whatever the profile's display format is.
   */
  document?: boolean
  /** Keep the operation out of the CLI surface entirely. */
  hidden?: boolean
}

/** The contract: operation name → how it appears in the terminal. */
export type CliContract = Partial<Record<V2OperationName, CommandSpec>>
