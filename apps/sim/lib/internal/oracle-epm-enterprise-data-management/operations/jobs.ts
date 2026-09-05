import {
  downloadEdmJobResult,
  readEdmJob,
  readEdmJobResult,
} from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import type {
  EdmInput,
  EdmOperationContext,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function getEdmJobStatus(
  input: EdmInput<'get_job_status'>,
  context: EdmOperationContext
) {
  return { job: await readEdmJob(input.jobRunId, context) }
}

export async function getEdmJobResult(
  input: EdmInput<'get_job_result'>,
  context: EdmOperationContext
) {
  return input.downloadFile
    ? downloadEdmJobResult(input.jobRunId, input.fileName, context)
    : { result: await readEdmJobResult(input.jobRunId, context) }
}
