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
  /** Take a JSON string. Implied for object/array/unknown fields. */
  json?: boolean
  /** Overrides the help text otherwise taken from the OpenAPI description. */
  describe?: string
  /** Accepted values when the generated descriptor cannot recover an enum. */
  choices?: readonly string[]
  /** Expose a string-backed API boolean as a conventional terminal toggle. */
  boolean?: true
  /**
   * Never expose this field as a flag, and never send it.
   *
   * For request fields the terminal cannot honor — `stream: true` switches the
   * response to SSE, which the JSON client would try to `JSON.parse`. Offering
   * the flag would advertise a mode that breaks; a bespoke streaming command
   * owns that instead.
   */
  omit?: boolean
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
  /** Rendering hint; `auto` inspects the value. */
  format?: 'auto' | 'timestamp' | 'bytes' | 'duration' | 'bool' | 'cost' | 'count' | 'trace-count'
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
