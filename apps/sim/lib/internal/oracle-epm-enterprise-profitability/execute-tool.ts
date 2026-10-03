import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OracleEpmError } from '@/lib/internal/oracle-epm'
import { executeOracleEpcmFileOperation } from '@/lib/internal/oracle-epm-enterprise-profitability/files.server'
import { executeOracleEpcmJobOperation } from '@/lib/internal/oracle-epm-enterprise-profitability/jobs'
import { OracleEpcmOperationError } from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import { executeOracleEpcmOperation } from '@/lib/internal/oracle-epm-enterprise-profitability/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const PREFIX = 'oracle_epm_enterprise_profitability_'
const JOB_OPERATIONS = new Set([
  'get_job_status',
  'wait_for_job',
  'get_job_details',
  'get_child_job_details',
])
const FILE_OPERATIONS = new Set(['list_files', 'upload_file', 'download_file', 'delete_file'])

export const executeOracleEpcmTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.toolId.startsWith(PREFIX)) {
    return Response.json(
      { success: false, output: {}, error: 'Unsupported Oracle EPCM tool', retryable: false },
      { status: 400 }
    )
  }
  const operation = request.toolId.slice(PREFIX.length)
  try {
    const result = FILE_OPERATIONS.has(operation)
      ? await executeOracleEpcmFileOperation(
          operation,
          request.input,
          request.signal,
          request.context
        )
      : JOB_OPERATIONS.has(operation)
        ? await executeOracleEpcmJobOperation(operation, request.input, request.signal)
        : await executeOracleEpcmOperation(operation, request.input, request.signal)
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof OracleEpcmOperationError
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
      error instanceof OracleEpcmOperationError || error instanceof OracleEpmError
        ? error.message
        : timeout
          ? 'Oracle EPCM wait timed out; the remote job was not cancelled. Resume with the same job ID.'
          : isPayloadSizeLimitError(error)
            ? 'Oracle EPCM payload exceeded its allowed size'
            : 'Oracle EPCM operation failed'
    return Response.json(
      { success: false, output: {}, error: message, retryable: false },
      { status }
    )
  }
}
