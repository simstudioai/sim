import { describeError } from '@sim/utils/errors'
import { sanitizeForLogging } from '@/lib/core/security/redaction'

const MAX_DIAGNOSTIC_FIELD_LENGTH = 100

export interface McpSafeErrorDiagnostics {
  name: string
  code: string | undefined
  errno: string | undefined
  syscall: string | undefined
}

/** Returns bounded structural error fields without messages, causes, or session identifiers. */
export function getMcpSafeErrorDiagnostics(error: unknown): McpSafeErrorDiagnostics {
  const described = describeError(error)
  const sanitizeOptional = (value: string | undefined) =>
    value === undefined ? undefined : sanitizeForLogging(value, MAX_DIAGNOSTIC_FIELD_LENGTH)

  return {
    name: sanitizeForLogging(described.name, MAX_DIAGNOSTIC_FIELD_LENGTH),
    code: sanitizeOptional(described.code),
    errno: sanitizeOptional(described.errno),
    syscall: sanitizeOptional(described.syscall),
  }
}
