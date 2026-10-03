import type { Principal } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { extractDocumentStyle } from '@/lib/mothership/vfs/document-style'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'

const MAX_STYLE_FILE_BYTES = 100 * 1024 * 1024

export class StyleExtractionUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StyleExtractionUnsupportedError'
  }
}

export interface StyleWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

async function executeStyleWorkspaceFile({
  principal,
  input,
}: {
  principal: Principal
  input: StyleWorkspaceFileInput
  request?: OrchestrationRequestContext
}) {
  const { file } = await readWorkspaceFileMetadata.execute({ principal, input })
  const rawExt = file.name.split('.').pop()?.toLowerCase()
  if (rawExt !== 'docx' && rawExt !== 'pptx' && rawExt !== 'pdf') {
    throw new StyleExtractionUnsupportedError(
      'Style extraction supports .docx, .pptx, and .pdf files'
    )
  }
  if (file.size > MAX_STYLE_FILE_BYTES) {
    throw new StyleExtractionUnsupportedError(
      'File is too large for style extraction (limit: 100 MB)'
    )
  }
  const { content } = await readWorkspaceFileContent.execute({
    principal,
    input: { ...input, maxBytes: MAX_STYLE_FILE_BYTES },
  })
  const summary = await extractDocumentStyle(content, rawExt)
  if (!summary) {
    throw new StyleExtractionUnsupportedError(
      'Could not extract style — file may be encrypted, corrupt, image-only, or contain no parseable style information'
    )
  }
  return summary
}

export const styleWorkspaceFile = {
  operation: readWorkspaceFileContent.operation,
  execute: executeStyleWorkspaceFile,
} as const
