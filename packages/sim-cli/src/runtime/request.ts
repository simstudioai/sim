import { existsSync, readFileSync, readSync } from 'node:fs'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec, FlagSpec } from '../contract/types'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { type QueryValue, SimApiError } from '../http/client'
import { camel, kebab } from './derive'
import type { OperationSpec } from './types'

/** One request field, as the generator describes it. */
export interface FieldSpec {
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'array' | 'object' | 'unknown'
  required?: boolean
  values?: readonly string[]
  default?: unknown
  /** The field's `.describe()` from the route contract, used as `--help` text. */
  describe?: string
}

/**
 * The workspace never becomes a flag.
 *
 * It is the one field every workspace-scoped operation declares, and it comes
 * from the profile — surfacing it as `--workspace-id` on 30-odd commands would
 * duplicate the global `--workspace` and invite the two to disagree.
 */
export const PROFILE_INJECTED_FIELD = 'workspaceId'

/** Whether this path segment comes from the active profile's workspace. */
export function isProfileWorkspacePath(commandSpec: CommandSpec, param: string): boolean {
  return commandSpec.profileWorkspacePath === true && param === PROFILE_INJECTED_FIELD
}

/**
 * The slot a cursor-paginated operation carries its `cursor` field in.
 *
 * Pagination, not the name of a field, is what makes `limit` a page size. It
 * lives here rather than beside its reader in `execute.ts` because `options.ts`
 * has to ask the same question while it builds the flag, and importing
 * `execute.ts` from `options.ts` would close a module cycle — `execute.ts`
 * already reads `DEFAULT_PAGE_SIZE` from `options.ts`.
 */
export function cursorSlot(
  operationSpec: Pick<OperationSpec, 'query' | 'body'>
): 'query' | 'body' | null {
  if (operationSpec.query && 'cursor' in operationSpec.query) return 'query'
  if (operationSpec.body && 'cursor' in operationSpec.body) return 'body'
  return null
}

/** Kinds the CLI can only accept as a JSON string. */
const JSON_KINDS = new Set(['object', 'array', 'unknown'])

/** Kinds read through `Number`, where a blank does not survive: `Number('')` is `0`. */
const NUMERIC_KINDS: ReadonlySet<FieldSpec['kind']> = new Set(['number', 'integer'])

export function flagSpecFor(operation: V2OperationName, field: string): FlagSpec {
  return CLI_CONTRACT[operation]?.flags?.[field] ?? {}
}

/**
 * Long and short flags the root program has already claimed.
 *
 * Commander matches the root's own options across the whole of argv, including
 * after a subcommand name, so a leaf that declares one of these never sees what
 * the caller typed. The two failure modes differ only in how loud they are:
 * `--version` and `--help` terminate, so `sim workflows rollback wf_1 --version
 * 1` printed the CLI version and exited `0` without issuing a request; the
 * root's value flags do not terminate, so a colliding leaf simply reads
 * `undefined` and acts as though the flag were never typed.
 */
export const RESERVED_PROGRAM_FLAGS: ReadonlySet<string> = new Set([
  '--version',
  '-V',
  '--help',
  '-h',
  '--profile',
  '-P',
  '--endpoint',
  '--workspace',
  '-w',
  '--output',
])

/**
 * Spellings a derived flag name is moved to when it would be shadowed.
 *
 * Only the name the CLI derives is rewritten. A name the contract states
 * outright is left as written and caught by the build-time collision check
 * instead — an explicit spelling is somebody's decision, and quietly serving a
 * different flag than the one they wrote is how the shadowing went unnoticed in
 * the first place.
 */
const RESERVED_FLAG_REPLACEMENTS: Readonly<Record<string, string>> = {
  version: 'to-version',
}

/** The flag name a field is exposed under, honouring any contract override. */
export function flagNameFor(operation: V2OperationName, field: string): string {
  const declared = flagSpecFor(operation, field).name
  if (declared) return declared
  const derived = kebab(field)
  return RESERVED_FLAG_REPLACEMENTS[derived] ?? derived
}

/** The named option used for a path parameter that is contextual rather than primary. */
export function pathFlagNameFor(commandSpec: CommandSpec, param: string): string {
  return commandSpec.pathFlags?.[param]?.name ?? kebab(param)
}

export function takesJson(field: FieldSpec, flag: FlagSpec): boolean {
  // `rowCap` builds the object itself from a typed number, so the field's
  // object kind must not pull the flag back into the JSON form it replaces.
  if (flag.rowCap) return false
  return flag.json === true || JSON_KINDS.has(field.kind)
}

/** The route's ceiling on `limit.max`; stated here so the refusal can name it. */
const MAX_ROW_CAP = 1_000_000

/** Reads `--max-rows 100` as the `{ type: 'rows', max: 100 }` the route declares. */
function coerceRowCap(raw: unknown, flagName: string): { type: 'rows'; max: number } {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > MAX_ROW_CAP) {
    throw new SimApiError(
      `--${flagName} must be a whole number between 1 and ${MAX_ROW_CAP.toLocaleString('en-US')}`,
      0
    )
  }
  return { type: 'rows', max: value }
}

/**
 * Drains stdin synchronously.
 *
 * `readFileSync(0)` looks like the obvious way to do this and fails on the one
 * case that matters: a pipe is opened non-blocking, so a single read of an
 * upstream process that has not written yet returns EAGAIN rather than waiting,
 * and `export … | import --workflow @-` died with a raw stack trace. Reading in
 * a loop and treating EAGAIN as "not ready yet" is what makes a pipe work.
 *
 * `Atomics.wait` is the only synchronous sleep available; without it the retry
 * spins a core for as long as the writer takes.
 */
function readStdin(): string {
  const idle = new Int32Array(new SharedArrayBuffer(4))
  const buffer = Buffer.alloc(64 * 1024)
  const chunks: Buffer[] = []

  for (;;) {
    let read: number
    try {
      read = readSync(0, buffer, 0, buffer.length, null)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EAGAIN') {
        Atomics.wait(idle, 0, 0, 5)
        continue
      }
      // Some platforms report end-of-input on a pipe as EOF rather than 0.
      if (code === 'EOF') break
      throw error
    }
    if (read === 0) break
    chunks.push(Buffer.from(buffer.subarray(0, read)))
  }

  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Resolves a flag argument that may name a file instead of carrying its value
 * inline.
 *
 * `@path` reads the file and `@-` reads stdin, the curl convention. A workflow
 * export is hundreds of lines, and the shell makes passing that literally
 * unpleasant — unquoted `$(cat f.json)` word-splits into broken JSON, and the
 * quoted form is easy to get wrong. JSON never starts with `@`; primitive list
 * flags reserve it for this explicit file-input form.
 *
 * A value that genuinely starts with `@` is written `@@`, and only the leading
 * `@` is dropped. The escape lives here rather than in any one command so that
 * every `@`-aware flag inherits it: without it `--tag @urgent` has no spelling
 * at all, because it can only be read as a request to open a file named
 * `urgent`.
 */
/**
 * Points at `@@` when an `@value` names nothing on disk.
 *
 * `--allowed-emails @example.org` is the natural spelling of a domain pattern
 * and reads here as a request to open a file, and "cannot read example.org"
 * alone gives no clue the value has a literal spelling at all. Gated on ENOENT
 * so a real file that cannot be read (EACCES, EISDIR) is not answered with
 * advice about escaping.
 */
function literalAtHint(error: unknown, path: string): string {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
    ? `. To pass the literal value @${path}, write @@${path}`
    : ''
}

export function readArgumentSource(raw: string, flagName: string): { text: string; from: string } {
  if (raw.startsWith('@@')) return { text: raw.slice(1), from: '' }
  if (!raw.startsWith('@')) return { text: raw, from: '' }

  const path = raw.slice(1)
  if (path === '-') {
    if (process.stdin.isTTY) {
      throw new SimApiError(`--${flagName} @- reads stdin, but nothing is piped in`, 0)
    }
    try {
      return { text: readStdin(), from: ' (read from stdin)' }
    } catch (error) {
      throw new SimApiError(`--${flagName} cannot read stdin: ${(error as Error).message}`, 0)
    }
  }

  try {
    return { text: readFileSync(path, 'utf8'), from: ` (read from ${path})` }
  } catch (error) {
    throw new SimApiError(
      `--${flagName} cannot read ${path}: ${(error as Error).message}${literalAtHint(error, path)}`,
      0
    )
  }
}

/** A manifest line that carries no value: blank, or a `#` comment. */
function isManifestNoise(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

/**
 * Reads a primitive list from argv or a newline-delimited file. A `manifest`
 * list drops blank and `#` comment lines read from a file, so a requirements
 * file can be passed as it is on disk.
 */
function readListValues(raw: unknown, flagName: string, manifest = false): string[] {
  const arguments_ = Array.isArray(raw) ? raw : [raw]
  const values = arguments_.flatMap((argument) => {
    if (typeof argument !== 'string') {
      throw new SimApiError(`--${flagName} values must be strings`, 0)
    }

    if (!argument.startsWith('@')) return [argument]

    const source = readArgumentSource(argument, flagName)
    const lines = source.text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    const kept = manifest ? lines.filter((line) => !isManifestNoise(line)) : lines
    if (kept.length === 0) {
      throw new SimApiError(`--${flagName}${source.from} contains no values`, 0)
    }

    return kept.map((line, index) => {
      const value = line.trim()
      if (!value) {
        throw new SimApiError(
          `--${flagName}${source.from} has an empty value on line ${index + 1}`,
          0
        )
      }
      return value
    })
  })

  return values.map((value) => {
    const trimmed = value.trim()
    if (!trimmed) throw new SimApiError(`--${flagName} values cannot be empty`, 0)
    return trimmed
  })
}

/** A percent-escape the caller has already applied, well-formed enough to decode. */
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/

/** What `encodeURIComponent` leaves raw and the server's canonical encoder does not. */
const SUB_DELIMITERS = /[!'()*]/g

/**
 * Encodes one segment exactly as `encodeFolderPathSegment` does server-side.
 *
 * The route does not merely decode a path, it re-encodes each segment and
 * demands the result match byte for byte, so "close enough" is rejected outright
 * with `Path must be a canonical folder path`. `encodeURIComponent` alone leaves
 * `!'()*` raw — common in real folder names (`Q1 (draft)`, `Sam's stuff`) — and
 * spells a lone `.` or `..` as itself, which the server refuses to let address a
 * folder actually named that.
 */
function encodeFolderPathSegment(name: string): string {
  if (name === '.') return '%2E'
  if (name === '..') return '%2E%2E'
  return encodeURIComponent(name).replace(
    SUB_DELIMITERS,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * Rewrites one folder path into the API's canonical wire form.
 *
 * The wire form encodes each segment, so `/Folder 1` in the app is
 * `/Folder%201` to the API — and typing the name you can see was rejected with
 * a message that never said the word encoding. Splitting on `/` first is what
 * keeps the separators: `encodeURIComponent` over the whole path would turn
 * every one of them into `%2F` and address a single top-level folder whose name
 * contains slashes.
 *
 * Decoding each segment before encoding it is what makes this idempotent, and
 * it has to be: the encoded spelling is what the CLI prints today, what the
 * README shows, and therefore what people will paste back. `/Folder 1` and
 * `/Folder%201` must reach the same folder, and `%2520` is the failure to
 * avoid. The limit of that rule is a folder whose name really contains a `%`
 * followed by two hex digits — `100%20off` reads as `100 off`. A stray `%` is
 * safe, because it fails to decode and is encoded literally, and the ambiguous
 * name can always be typed in its encoded form (`100%2520off`).
 */
export function encodeFolderPath(value: string): string {
  return value
    .split('/')
    .map((segment) => {
      if (!PERCENT_ESCAPE.test(segment)) return encodeFolderPathSegment(segment)
      try {
        return encodeFolderPathSegment(decodeURIComponent(segment))
      } catch {
        return encodeFolderPathSegment(segment)
      }
    })
    .join('/')
}

/**
 * A fractional part `Number` cannot keep.
 *
 * Above 2^52 a double's spacing is 1, so `Number('4503599627370496.5')` is an
 * integer — `Number.isInteger` passes and the API receives a value the caller
 * did not type. Read the text as well as the parsed number so the refusal
 * covers the range where the parse itself loses the fraction. Digits that are
 * all zero are not a fraction, so `1.0` stays a whole number.
 */
const FRACTIONAL_DIGITS = /\.\d*[1-9]/

/**
 * Points at `@` when a value that failed to parse looks like a filename.
 *
 * `--workflow export.json` is the natural first guess, and "must be valid JSON"
 * alone gives no clue that passing a file is even supported.
 */
function pathHint(raw: string): string {
  if (raw.startsWith('@') || /^\s*[[{"\-\d]|^\s*(true|false|null)/.test(raw)) return ''
  return existsSync(raw)
    ? `. ${raw} is a file — pass it as @${raw}`
    : '. To read a file, pass @path (or @- for stdin)'
}

/**
 * Turns the string argv provides into the value the contract expects.
 *
 * Every failure names the flag rather than the field, because the flag is what
 * the caller typed — and every one of these is caught before any request is
 * made, so a typo costs nothing.
 */
export function coerce(raw: unknown, field: FieldSpec, flag: FlagSpec, flagName: string): unknown {
  if (raw === undefined) return undefined

  /**
   * A repeated flag. `list` says the CLI accepts several values; the *wire*
   * encoding follows the field's own kind, because the two are not the same
   * question:
   *
   * - `string` — the route splits on commas (`workflowIds`, `folderPaths`,
   *   `triggers`), so the values are joined.
   * - anything else — the wire genuinely wants an array (`rowIds`,
   *   `selectedOutputs`) or a string-or-array union whose array branch is the
   *   right one (`knowledgeBaseIds`). Joining those produced a single bogus id
   *   or failed validation outright.
   */
  if (flag.list) {
    const values = readListValues(raw, flagName, flag.manifest === true).map((value) =>
      flag.folderPath ? encodeFolderPath(value) : value
    )
    // Encoding first is also what keeps the comma-joined form unambiguous: a
    // folder name containing a comma leaves here as `%2C`, so the route's split
    // cannot cut one path in half.
    return field.kind === 'string' ? values.join(',') : values
  }

  if (flag.rowCap) return coerceRowCap(raw, flagName)

  if (takesJson(field, flag)) {
    if (typeof raw !== 'string') return raw
    const source = readArgumentSource(raw, flagName)
    try {
      return JSON.parse(source.text)
    } catch (error) {
      throw new SimApiError(
        `--${flagName} must be valid JSON${source.from}: ${(error as Error).message}${pathHint(raw)}`,
        0
      )
    }
  }

  if (NUMERIC_KINDS.has(field.kind)) {
    const value = Number(raw)
    if (Number.isNaN(value)) throw new SimApiError(`--${flagName} must be a number`, 0)
    /**
     * An `integer` field said so in the contract, and every other constraint on
     * one is already refused here by hand. Leaving integrality to the server
     * answered `--max-bytes 5.5` with `Invalid input: expected int, received
     * number` and `--max-bytes 999999999999999999999` with `Too big: expected
     * int to be <=9007199254740991` — library wording naming neither the flag
     * nor anything the caller typed, on the one flag whose blank, zero and
     * non-numeric cases all had a sentence written for them.
     */
    if (
      field.kind === 'integer' &&
      (!Number.isInteger(value) || FRACTIONAL_DIGITS.test(String(raw)))
    ) {
      throw new SimApiError(`--${flagName} must be a whole number`, 0)
    }
    if (field.kind === 'integer' && !Number.isSafeInteger(value)) {
      throw new SimApiError(
        `--${flagName} is outside the whole-number range the API accepts (±${Number.MAX_SAFE_INTEGER})`,
        0
      )
    }
    return value
  }

  if (field.kind === 'boolean' || flag.boolean) return raw === true || raw === 'true'

  const choices = flag.choices ?? field.values
  if (choices && !choices.includes(String(raw))) {
    throw new SimApiError(`--${flagName} must be one of: ${choices.join(', ')}`, 0)
  }

  if (flag.folderPath && typeof raw === 'string') return encodeFolderPath(raw)

  return raw
}

/**
 * The workspace precondition as stated when the profile is not at hand.
 *
 * `executeOperation` resolves the workspace through `SimClient.requireWorkspace`
 * first, which names the profile and checks the API key, so this is a defensive
 * floor rather than the wording a caller sees.
 */
const NO_WORKSPACE_FALLBACK =
  'No workspace set. Pass --workspace, or run: sim configure --set-workspace <id>'

export interface BuiltRequest {
  path: string
  query: Record<string, QueryValue>
  body: Record<string, unknown> | undefined
  /** Contract-declared request headers, absent when the operation declares none. */
  headers?: Record<string, string>
}

/**
 * A query string can only carry scalars. Every v2 query field is one today, but
 * a structured field could be added — serializing it here keeps that a working
 * request rather than `[object Object]`.
 */
function asQueryValue(value: unknown): QueryValue {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object') return JSON.stringify(value)
  return value as QueryValue
}

/**
 * Assembles one operation's HTTP request from positional args, parsed flags,
 * and the profile's workspace.
 *
 * Primary path params come from positional arguments in declared order. A
 * contextual path param can instead come from a named option declared by the
 * CLI contract. Every other field is looked up by its flag name in the slot the
 * API contract declares it in, so a field that moved from query to body moves
 * here on the next regeneration.
 */
export function buildRequest(
  operation: V2OperationName,
  positional: string[],
  flags: Record<string, unknown>,
  workspaceId: string | null
): BuiltRequest {
  const commandSpec: CommandSpec = CLI_CONTRACT[operation] ?? {}
  const spec = V2_OPERATIONS[operation] as {
    method: string
    path: string
    pathParams: readonly string[]
    query?: Record<string, FieldSpec>
    body?: Record<string, FieldSpec>
    headers?: Record<string, FieldSpec>
    opaqueBody?: boolean
  }

  let path = spec.path
  let positionalIndex = 0
  for (const param of spec.pathParams) {
    const pathFlag = commandSpec.pathFlags?.[param]
    const profileWorkspacePath = isProfileWorkspacePath(commandSpec, param)
    const flagName = pathFlagNameFor(commandSpec, param)
    const argumentName = commandSpec.pathArgumentNames?.[param] ?? param
    const value = profileWorkspacePath
      ? workspaceId
      : pathFlag
        ? flags[camel(flagName)]
        : positional[positionalIndex++]
    if (value === undefined || value === null) {
      if (profileWorkspacePath) {
        throw new SimApiError(NO_WORKSPACE_FALLBACK, 0)
      }
      throw new SimApiError(pathFlag ? `--${flagName} is required` : `Missing <${argumentName}>`, 0)
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new SimApiError(
        pathFlag ? `--${flagName} cannot be empty` : `<${argumentName}> cannot be empty`,
        0
      )
    }
    // Ids are opaque; an unencoded `/` or `?` would silently retarget the request.
    path = path.replace(`[${param}]`, encodeURIComponent(value))
  }

  const query: Record<string, QueryValue> = {}
  const body: Record<string, unknown> = {}
  const headers: Record<string, string> = {}

  /**
   * On a paginating operation `limit` is the walk size rather than a filter,
   * and the pager reads it from the flags itself — including refusing a blank
   * one, in wording that says what `0` means there. Left to it, so the caller
   * gets that message instead of the generic refusal below.
   */
  const paginatedLimit = cursorSlot(spec) !== null

  for (const slot of ['query', 'body', 'headers'] as const) {
    for (const [field, descriptor] of Object.entries(spec[slot] ?? {})) {
      const flag = flagSpecFor(operation, field)
      if (flag.omit) continue

      const flagName = flagNameFor(operation, field)
      // Commander stores `--min-duration-ms` as `minDurationMs`; reading by the
      // flag's own name silently finds nothing.
      const omitProfileWorkspace = commandSpec.allWorkspaces && flags.allWorkspaces === true
      const provided =
        field === PROFILE_INJECTED_FIELD
          ? omitProfileWorkspace
            ? undefined
            : workspaceId
          : flags[camel(flagName)]
      // A contract default only applies to what the caller left unsaid, so
      // typing the flag — including typing the server's own default back — still
      // decides. It is validated like any other value, enum choices included.
      const raw = provided ?? flag.requestDefault

      /**
       * A blank filter is a mistake, and every v2 JSON route says so
       * (`rejectBlankQueryValues`). The CLI never let one reach the wire: the
       * URL builder skips an empty value, so `logs list --status ""` searched
       * everything and answered `0`, a wider result set presented as an answer.
       * Refused here, before the request, the way an empty list entry and an
       * empty path parameter already are.
       *
       * Read from what the caller typed rather than from the coerced value,
       * because coercion erases the blank on a numeric field: `Number('')` is
       * `0`, so `--max-cost ""` reached the wire as a real "costing at most
       * nothing" filter that a check on the coerced value cannot see. An
       * explicit `--max-cost 0` is a value the caller chose and is still sent.
       *
       * That erasure is what a numeric *body* field suffers too, so the rule is
       * the whole query slot plus every numeric field wherever it sits: `tables
       * rows batch-delete --limit ""` sent `"limit":0`, a cap the caller never
       * typed. The slot alone is not the distinction — a blank is meaningful
       * only where it can survive as itself, which is a body *string*, where it
       * clears a description.
       *
       * Blank is `trim()`-empty rather than exactly empty, matching both the
       * route — `blankQueryValueValidationError` reads `?status=%20` as blank —
       * and the list flag beside it, which trims each entry before refusing it.
       * A quoted space is invisible in a shell and read as every blank the
       * empty string did: `--max-cost " "` as `0`, `--deployed-only " "` as an
       * explicit `false`, `--status " "` as a `%20` the server answers `400`.
       */
      if (
        (slot === 'query' || NUMERIC_KINDS.has(descriptor.kind)) &&
        typeof raw === 'string' &&
        raw.trim() === '' &&
        !(field === 'limit' && paginatedLimit)
      ) {
        throw new SimApiError(`--${flagName} cannot be empty`, 0)
      }

      const value = coerce(raw ?? undefined, descriptor, flag, flagName)

      /**
       * A non-paginated `limit` is a row cap the route bounds at `1`, which is
       * what `--help` already tells the caller ("note 0 is not accepted") — so
       * `--limit 0`, `-1` and `1.5` were shipping a round trip to be told
       * something the CLI had documented. The ceiling stays with the server:
       * it is per-route policy, and nothing in the terminal states it.
       */
      if (
        field === 'limit' &&
        !paginatedLimit &&
        NUMERIC_KINDS.has(descriptor.kind) &&
        typeof value === 'number' &&
        value < 1
      ) {
        throw new SimApiError(`--${flagName} must be 1 or more`, 0)
      }

      if (value === undefined) {
        if (descriptor.required) {
          throw new SimApiError(
            field === PROFILE_INJECTED_FIELD ? NO_WORKSPACE_FALLBACK : `--${flagName} is required`,
            0
          )
        }
        // Omitted rather than sent as null: the server applies its own default,
        // and sending an explicit undefined would override it with nothing.
        continue
      }

      if (slot === 'query') query[field] = asQueryValue(value)
      // A header is a wire string: the contracts declare only string headers,
      // and anything else would reach `fetch` as `[object Object]`.
      else if (slot === 'headers') headers[field] = String(value)
      else body[field] = value
    }
  }

  /**
   * Left off entirely when the operation declared none, so a request without
   * contract headers is byte-for-byte the request it was before.
   */
  const headerSlot = Object.keys(headers).length > 0 ? { headers } : {}

  // A union body comes in whole through `--body`, merged over the fields the
  // branches share. Replacing outright dropped the profile's `workspaceId`,
  // which both branches require, so every insert came back as invalid input.
  // The caller's JSON still wins on any key it sets.
  if (spec.opaqueBody) {
    if (commandSpec.bodyVariants) {
      const provided = commandSpec.bodyVariants.filter(
        (variant) => flags[camel(variant.name)] !== undefined
      )
      const names = commandSpec.bodyVariants.map((variant) => `--${variant.name}`).join(' or ')
      if (provided.length !== 1) {
        throw new SimApiError(`Pass exactly one of ${names}`, 0)
      }

      const variant = provided[0]
      const raw = flags[camel(variant.name)]
      if (typeof raw !== 'string') throw new SimApiError(`--${variant.name} is required`, 0)
      const parsed = coerce(raw, { kind: variant.kind }, { json: true }, variant.name)
      if (
        (variant.kind === 'object' &&
          (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) ||
        (variant.kind === 'array' && !Array.isArray(parsed))
      ) {
        throw new SimApiError(`--${variant.name} must be a JSON ${variant.kind}`, 0)
      }
      return { path, query, body: { ...body, [variant.property]: parsed }, ...headerSlot }
    }

    const raw = flags.body
    if (typeof raw !== 'string') throw new SimApiError('--body is required', 0)
    const parsed = coerce(raw, { kind: 'object' }, { json: true }, 'body')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SimApiError('--body must be a JSON object', 0)
    }
    return { path, query, body: { ...body, ...(parsed as Record<string, unknown>) }, ...headerSlot }
  }

  return {
    path,
    query,
    /**
     * A declared JSON body is still an object when all of its fields are optional.
     * Sending no bytes makes the server reject before field defaults can apply.
     */
    body: spec.body ? body : undefined,
    ...headerSlot,
  }
}
