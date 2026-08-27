import type { CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import { SimApiError } from '../http/client'
import { flagNameFor, flagSpecFor, PROFILE_INJECTED_FIELD, pathFlagNameFor } from './request'
import type { OperationSpec } from './types'

/**
 * Identifiers a message quotes from the wire rather than from English.
 *
 * Genuine multi-segment camelCase — `includeJobRuns`, `startDate` — never
 * occurs as prose, so replacing it is safe. A single word is left alone in
 * prose: `startDate must name a storable instant` contains the field `name`,
 * and substituting it would produce `must --name a storable instant`. The
 * structured `details:` column still translates single-word fields, because
 * there position identifies them rather than the surrounding sentence.
 */
const WIRE_IDENTIFIER = /^[a-z]+[A-Z]/

/**
 * The spelling a caller types for a wire field, or `null` when there is none.
 *
 * Resolved through the same helpers the command builder uses, never by
 * kebab-casing the wire name: `folderPath` is typed `--folder` and
 * `knowledgeBaseIds` is typed `--kb`, so a mechanical translation would name
 * flags that do not exist — strictly worse than leaving the wire name alone.
 */
export function spellingFor(
  operation: V2OperationName,
  commandSpec: CommandSpec,
  operationSpec: OperationSpec,
  field: string
): string | null {
  if (field === PROFILE_INJECTED_FIELD) return '--workspace'
  if (field === 'cursor') return null

  if (operationSpec.pathParams.includes(field)) {
    return commandSpec.pathFlags?.[field]
      ? `--${pathFlagNameFor(commandSpec, field)}`
      : `<${commandSpec.pathArgumentNames?.[field] ?? field}>`
  }

  if (commandSpec.positionals?.includes(field)) return `<${flagNameFor(operation, field)}>`
  if (flagSpecFor(operation, field).omit) return null
  if (commandSpec.requestFields && !commandSpec.requestFields.includes(field)) return null

  const declared =
    (operationSpec.query && field in operationSpec.query) ||
    (operationSpec.body && field in operationSpec.body) ||
    (operationSpec.headers && field in operationSpec.headers)
  if (!declared) return null

  return `--${flagNameFor(operation, field)}`
}

/** Every field of this operation a caller can type, keyed by its wire name. */
function typeableFields(
  operation: V2OperationName,
  commandSpec: CommandSpec,
  operationSpec: OperationSpec
): Map<string, string> {
  const spellings = new Map<string, string>()
  const fields = [
    ...operationSpec.pathParams,
    ...Object.keys(operationSpec.query ?? {}),
    ...Object.keys(operationSpec.body ?? {}),
    ...Object.keys(operationSpec.headers ?? {}),
  ]
  for (const field of fields) {
    if (spellings.has(field)) continue
    const spelling = spellingFor(operation, commandSpec, operationSpec, field)
    if (spelling) spellings.set(field, spelling)
  }
  return spellings
}

/**
 * Rewrites wire names a message quotes into the flags the caller typed.
 *
 * All or nothing. Only multi-segment camelCase is safely rewritable in prose —
 * see {@link WIRE_IDENTIFIER} — so a sentence enumerating both kinds came out
 * half in one vocabulary and half in the other: `At least one of name,
 * description, or --folder is required` reads as three different things, one of
 * which is a flag. When a single-word field of the same operation survives the
 * pass, the whole message is left as the server wrote it: entirely in wire
 * names, which is at least internally consistent and matches the REST
 * reference the caller can look the names up in.
 *
 * The cost is that a message mentioning `folderPath` and the English word
 * `name` loses a translation it could have had. That is the deliberate trade —
 * telling the two apart is the undecidable problem that produced the mixed
 * sentence in the first place, and an unhelpful sentence beats a misleading one.
 */
function retypeMessage(message: string, spellings: Map<string, string>): string {
  let retyped = message
  for (const [field, spelling] of spellings) {
    if (!WIRE_IDENTIFIER.test(field)) continue
    retyped = retyped.replaceAll(new RegExp(`\\b${field}\\b`, 'g'), spelling)
  }
  if (retyped === message) return message

  for (const field of spellings.keys()) {
    if (WIRE_IDENTIFIER.test(field)) continue
    if (new RegExp(`\\b${field}\\b`).test(retyped)) return message
  }
  return retyped
}

/** Rewrites the head of one issue path, leaving keys inside a caller's JSON alone. */
function retypeDetails(details: unknown, spellings: Map<string, string>): unknown {
  if (Array.isArray(details)) return details.map((issue) => retypeDetails(issue, spellings))
  if (!details || typeof details !== 'object') return details

  const issue = details as Record<string, unknown>
  const retyped: Record<string, unknown> = { ...issue }

  if (Array.isArray(issue.path) && issue.path.length > 0) {
    const [head, ...rest] = issue.path.map(String)
    const spelling = spellings.get(head)
    // Only the head names a field the caller typed; the rest address keys
    // inside a JSON value they wrote themselves.
    if (spelling) retyped.path = [spelling, ...rest]
  }
  if (typeof issue.message === 'string') {
    retyped.message = retypeMessage(issue.message, spellings)
  }
  if (Array.isArray(issue.errors)) {
    retyped.errors = retypeDetails(issue.errors, spellings)
  }

  return retyped
}

/**
 * Restates a server validation error in the spellings the terminal accepts.
 *
 * The API names its own fields, correctly — `drop includeJobRuns` is right for
 * an OpenAPI reader and untypeable here, where the flag is
 * `--include-job-runs`. Applied at the one frame that still holds the
 * operation, its command spec and its operation spec; by the time the error
 * reaches the entrypoint that context is gone.
 *
 * A CLI-raised error (`status: 0`) is already phrased in flags and passes
 * through untouched, as does anything that is not a `SimApiError`.
 */
export function retypeApiError(
  error: unknown,
  operation: V2OperationName,
  commandSpec: CommandSpec,
  operationSpec: OperationSpec
): unknown {
  if (!(error instanceof SimApiError) || error.status === 0) return error

  const spellings = typeableFields(operation, commandSpec, operationSpec)
  if (spellings.size === 0) return error

  return new SimApiError(
    retypeMessage(error.message, spellings),
    error.status,
    error.code,
    error.details === undefined ? undefined : retypeDetails(error.details, spellings)
  )
}
