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
    try {
      return JSON.parse(raw)
    } catch (error) {
      throw new SimApiError(`--${flagName} must be valid JSON: ${(error as Error).message}`, 0)
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
