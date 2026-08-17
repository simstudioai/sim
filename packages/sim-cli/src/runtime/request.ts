import { existsSync, readFileSync, readSync } from 'node:fs'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec, FlagSpec } from '../contract/types'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { type QueryValue, SimApiError } from '../http/client'
import { camel, kebab } from './derive'

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

/** Kinds the CLI can only accept as a JSON string. */
const JSON_KINDS = new Set(['object', 'array', 'unknown'])

export function flagSpecFor(operation: V2OperationName, field: string): FlagSpec {
  return CLI_CONTRACT[operation]?.flags?.[field] ?? {}
}

/** The flag name a field is exposed under, honouring any contract override. */
export function flagNameFor(operation: V2OperationName, field: string): string {
  return flagSpecFor(operation, field).name ?? kebab(field)
}

/** The named option used for a path parameter that is contextual rather than primary. */
export function pathFlagNameFor(commandSpec: CommandSpec, param: string): string {
  return commandSpec.pathFlags?.[param]?.name ?? kebab(param)
}

export function takesJson(field: FieldSpec, flag: FlagSpec): boolean {
  return flag.json === true || JSON_KINDS.has(field.kind)
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
 */
function readArgumentSource(raw: string, flagName: string): { text: string; from: string } {
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
    throw new SimApiError(`--${flagName} cannot read ${path}: ${(error as Error).message}`, 0)
  }
}

/** Reads a primitive list from argv or a newline-delimited file. */
function readListValues(raw: unknown, flagName: string): string[] {
  const arguments_ = Array.isArray(raw) ? raw : [raw]
  const values = arguments_.flatMap((argument) => {
    if (typeof argument !== 'string') {
      throw new SimApiError(`--${flagName} values must be strings`, 0)
    }

    if (!argument.startsWith('@')) return [argument]

    const source = readArgumentSource(argument, flagName)
    const lines = source.text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    if (lines.length === 0) {
      throw new SimApiError(`--${flagName}${source.from} contains no values`, 0)
    }

    return lines.map((line, index) => {
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
    const values = readListValues(raw, flagName).map((value) =>
      flag.folderPath ? encodeFolderPath(value) : value
    )
    // Encoding first is also what keeps the comma-joined form unambiguous: a
    // folder name containing a comma leaves here as `%2C`, so the route's split
    // cannot cut one path in half.
    return field.kind === 'string' ? values.join(',') : values
  }

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

  if (field.kind === 'number' || field.kind === 'integer') {
    const value = Number(raw)
    if (Number.isNaN(value)) throw new SimApiError(`--${flagName} must be a number`, 0)
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

export interface BuiltRequest {
  path: string
  query: Record<string, QueryValue>
  body: Record<string, unknown> | undefined
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
        throw new SimApiError(
          'No workspace set. Pass --workspace, or run: sim configure --set-workspace <id>',
          0
        )
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

  for (const slot of ['query', 'body'] as const) {
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
      const value = coerce(raw ?? undefined, descriptor, flag, flagName)

      if (value === undefined) {
        if (descriptor.required) {
          throw new SimApiError(
            field === PROFILE_INJECTED_FIELD
              ? 'No workspace set. Pass --workspace, or run: sim configure --set-workspace <id>'
              : `--${flagName} is required`,
            0
          )
        }
        // Omitted rather than sent as null: the server applies its own default,
        // and sending an explicit undefined would override it with nothing.
        continue
      }

      if (slot === 'query') query[field] = asQueryValue(value)
      else body[field] = value
    }
  }

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
      return { path, query, body: { ...body, [variant.property]: parsed } }
    }

    const raw = flags.body
    if (typeof raw !== 'string') throw new SimApiError('--body is required', 0)
    const parsed = coerce(raw, { kind: 'object' }, { json: true }, 'body')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SimApiError('--body must be a JSON object', 0)
    }
    return { path, query, body: { ...body, ...(parsed as Record<string, unknown>) } }
  }

  return {
    path,
    query,
    /**
     * A declared JSON body is still an object when all of its fields are optional.
     * Sending no bytes makes the server reject before field defaults can apply.
     */
    body: spec.body ? body : undefined,
  }
}
