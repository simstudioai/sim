import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { redactExactSensitiveValues } from '@/lib/core/security/redaction'

const MAX_CREDENTIAL_NODES = 256
const MAX_CREDENTIAL_DEPTH = 8
const MAX_CREDENTIAL_BYTES = 1024 * 1024
const MAX_ERROR_INPUT_CHARS = 16_000
const MAX_ERROR_OUTPUT_CHARS = 4000
const REDACTED_ERROR = 'Data drain destination failed (details redacted)'

/**
 * Removes saved credential values, including leaves inside JSON credentials, before errors reach
 * history, audit, logs or the job queue. Malformed JSON and collection limits hide the entire
 * diagnostic because providers may echo only a fragment of a credential container.
 */
export function createCredentialErrorRedactor(credentials?: unknown): (error: unknown) => string {
  const secrets: string[] = []
  let nodes = 0
  let bytes = 0
  let complete = credentials !== undefined

  function collect(value: unknown, depth: number): void {
    if (++nodes > MAX_CREDENTIAL_NODES || depth > MAX_CREDENTIAL_DEPTH) {
      complete = false
      return
    }
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value, 'utf8')
      if (bytes > MAX_CREDENTIAL_BYTES) {
        complete = false
        return
      }
      if (value) secrets.push(value)
      const trimmed = value.trimStart()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          collect(JSON.parse(value), depth + 1)
        } catch {
          complete = false
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (!complete) break
        collect(item, depth + 1)
      }
    } else if (isRecordLike(value)) {
      for (const key in value) {
        if (!complete) break
        if (Object.hasOwn(value, key)) collect(value[key], depth + 1)
      }
    }
  }

  collect(credentials, 0)
  return (error) => {
    if (!complete) return REDACTED_ERROR
    const message = toError(error).message
    if (message.length > MAX_ERROR_INPUT_CHARS) return REDACTED_ERROR
    return truncate(redactExactSensitiveValues(message, secrets), MAX_ERROR_OUTPUT_CHARS, '')
  }
}
