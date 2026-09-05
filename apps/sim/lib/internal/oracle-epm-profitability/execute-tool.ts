import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OracleEpmError } from '@/lib/internal/oracle-epm'
import { executeOraclePcmFileOperation } from '@/lib/internal/oracle-epm-profitability/files.server'
import { executeOraclePcmJobOperation } from '@/lib/internal/oracle-epm-profitability/jobs'
import { OraclePcmOperationError } from '@/lib/internal/oracle-epm-profitability/normalizers'
import { executeOraclePcmOperation } from '@/lib/internal/oracle-epm-profitability/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const PREFIX = 'oracle_epm_profitability_'
const JOB_OPERATIONS = new Set(['get_task_status', 'wait_for_task'])
const FILE_OPERATIONS = new Set(['list_files', 'upload_file', 'download_file'])

export const executeOraclePcmTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.toolId.startsWith(PREFIX)) {
    return Response.json(
      { success: false, output: {}, error: 'Unsupported Oracle PCM tool', retryable: false },
      { status: 400 }
    )
  }
  const operation = request.toolId.slice(PREFIX.length)
  try {
    const result = FILE_OPERATIONS.has(operation)
      ? await executeOraclePcmFileOperation(
          operation,
          request.input,
          request.signal,
          request.context
        )
      : JOB_OPERATIONS.has(operation)
        ? await executeOraclePcmJobOperation(operation, request.input, request.signal)
        : await executeOraclePcmOperation(operation, request.input, request.signal)
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof OraclePcmOperationError
        ? error.status
        : error instanceof OracleEpmError
          ? (error.status ??
            (error.category === 'timeout'
              ? 408
              : error.category === 'payload_too_large'
                ? 413
                : 502))
          : timeout
            ? 408
            : 500
    const message =
      error instanceof OraclePcmOperationError || error instanceof OracleEpmError
        ? error.message
        : timeout
          ? 'Oracle PCM wait timed out; the remote task was not cancelled. Resume with the same processName.'
          : isPayloadSizeLimitError(error)
            ? 'Oracle PCM payload exceeded its allowed size'
            : 'Oracle PCM operation failed'
    return Response.json(
      { success: false, output: {}, error: message, retryable: false },
      { status }
    )
  }
}
