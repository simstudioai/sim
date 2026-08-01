import { existsSync, readFileSync, readSync } from 'node:fs'
import { CLI_CONTRACT } from '../contract/commands.js'
import type { FlagSpec } from '../contract/types.js'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api.js'
import { type QueryValue, SimApiError } from '../http/client.js'
import { camel, kebab } from './derive.js'

/** One request field, as the generator describes it. */
export interface FieldSpec {
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'array' | 'object' | 'unknown'
  required?: boolean
  values?: readonly string[]
  default?: unknown
}

/**
 * The workspace never becomes a flag.
 *
 * It is the one field every workspace-scoped operation declares, and it comes
 * from the profile — surfacing it as `--workspace-id` on 30-odd commands would
 * duplicate the global `--workspace` and invite the two to disagree.
 */
export const PROFILE_INJECTED_FIELD = 'workspaceId'

/** Kinds the CLI can only accept as a JSON string. */
const JSON_KINDS = new Set(['object', 'array', 'unknown'])

export function flagSpecFor(operation: V2OperationName, field: string): FlagSpec {
  return CLI_CONTRACT[operation]?.flags?.[field] ?? {}
}

/** The flag name a field is exposed under, honouring any contract override. */
export function flagNameFor(operation: V2OperationName, field: string): string {
  return flagSpecFor(operation, field).name ?? kebab(field)
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
 * Resolves a JSON flag's argument, which may name a file instead of carrying
 * the document inline.
 *
 * `@path` reads the file and `@-` reads stdin, the curl convention. A workflow
 * export is hundreds of lines, and the shell makes passing that literally
 * unpleasant — unquoted `$(cat f.json)` word-splits into broken JSON, and the
 * quoted form is easy to get wrong. `@` cannot collide with a real value
 * because JSON only ever starts with `{ [ " -`, a digit, or t/f/n.
 */
function readJsonArgument(raw: string, flagName: string): { text: string; from: string } {
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
   * - `string` — the route splits on commas (`workflowIds`, `folderIds`,
   *   `triggers`), so the values are joined.
   * - anything else — the wire genuinely wants an array (`rowIds`,
   *   `selectedOutputs`) or a string-or-array union whose array branch is the
   *   right one (`knowledgeBaseIds`). Joining those produced a single bogus id
   *   or failed validation outright.
   */
  if (flag.list) {
    const values = Array.isArray(raw) ? raw : [raw]
    return field.kind === 'string' ? values.join(',') : values
  }

  if (takesJson(field, flag)) {
    if (typeof raw !== 'string') return raw
    const source = readJsonArgument(raw, flagName)
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

  if (field.kind === 'boolean') return raw === true || raw === 'true'

  if (field.kind === 'enum' && field.values && !field.values.includes(String(raw))) {
    throw new SimApiError(`--${flagName} must be one of: ${field.values.join(', ')}`, 0)
  }

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
 * Path params come from positional arguments in declared order; every other
 * field is looked up by its flag name in the slot the contract declares it in,
 * so a field that moved from query to body moves here on the next regeneration.
 */
export function buildRequest(
  operation: V2OperationName,
  positional: string[],
  flags: Record<string, unknown>,
  workspaceId: string | null
): BuiltRequest {
  const spec = V2_OPERATIONS[operation] as {
    method: string
    path: string
    pathParams: readonly string[]
    query?: Record<string, FieldSpec>
    body?: Record<string, FieldSpec>
  }

  let path = spec.path
  spec.pathParams.forEach((param, index) => {
    const value = positional[index]
    if (value === undefined) throw new SimApiError(`Missing <${param}>`, 0)
    // Ids are opaque; an unencoded `/` or `?` would silently retarget the request.
    path = path.replace(`[${param}]`, encodeURIComponent(value))
  })

  const query: Record<string, QueryValue> = {}
  const body: Record<string, unknown> = {}

  for (const slot of ['query', 'body'] as const) {
    for (const [field, descriptor] of Object.entries(spec[slot] ?? {})) {
      const flag = flagSpecFor(operation, field)
      if (flag.omit) continue

      const flagName = flagNameFor(operation, field)
      // Commander stores `--min-duration-ms` as `minDurationMs`; reading by the
      // flag's own name silently finds nothing.
      const raw = field === PROFILE_INJECTED_FIELD ? workspaceId : flags[camel(flagName)]
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

  return {
    path,
    query,
    body: Object.keys(body).length > 0 ? body : undefined,
  }
}
