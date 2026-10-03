import type { Principal } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'
import { readWorkspaceFileContentRecord } from '@/lib/workspace-files/application/read-workspace-file-record'

export interface CsvPreviewWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
  key: string
  signal?: AbortSignal
}

async function executeCsvPreviewWorkspaceFile({
  principal,
  input,
  request,
}: {
  principal: Principal
  input: CsvPreviewWorkspaceFileInput
  request?: OrchestrationRequestContext
}) {
  const { file } = await readWorkspaceFileContentRecord.execute({ principal, input, request })
  if (file.key !== input.key) throw new OrchestrationError('not_found', 'File not found')
  const slice = await getCsvPreviewSlice({
    key: file.key,
    context: 'workspace',
    signal: input.signal,
  })
  return { success: true as const, ...slice }
}

export const csvPreviewWorkspaceFile = {
  operation: readWorkspaceFileContentRecord.operation,
  execute: executeCsvPreviewWorkspaceFile,
} as const
