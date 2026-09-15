import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { SimApiError } from 'sim/embed'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type AgentCliEngine,
  type AgentCliFlags,
  type AgentCliRuntime,
  agentCliFail,
} from '@/lib/mothership/agent-cli/types'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'
import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'
import { decodeFileVisual } from '@/lib/workspace-files/decode-file-visual'

const logger = createLogger('FileRead')

/** Only expected domain failures become user-visible errors. */
export function fileReadFailure(error: unknown) {
  if (error instanceof SimApiError) return agentCliFail(error.message)
  if (error instanceof OrchestrationError && error.code !== 'internal')
    return agentCliFail(error.message)
  logger.error('File observation failed', { error: getErrorMessage(error) })
  return agentCliFail('The file could not be read. Retry this read before making content claims.')
}

/** Canonical artifact access checks provenance before any bytes reach a decoder or model. */
export async function readFileVisual(
  reference: string,
  runtime: AgentCliRuntime,
  flags: AgentCliFlags,
  maxBytes = MAX_TEXT_EXTRACTION_BYTES
) {
  if (!runtime.principal)
    throw new OrchestrationError(
      'unauthorized',
      'Workspace authentication is unavailable. Retry the read.'
    )
  if (flags.pages !== undefined && (typeof flags.pages !== 'string' || !flags.pages.trim())) {
    throw new OrchestrationError('validation', '--pages requires a page number or range.')
  }
  if (flags.render !== undefined && flags.render !== true) {
    throw new OrchestrationError('validation', '--render is a flag without a value.')
  }
  runtime.signal?.throwIfAborted()
  const { file, buffer, contentType } = await readWorkspaceFileArtifact.execute({
    principal: runtime.principal,
    input: {
      workspaceId: runtime.workspaceId,
      reference,
      maxBytes,
      ...(runtime.chatId !== undefined ? { chatId: runtime.chatId } : {}),
    },
  })
  runtime.signal?.throwIfAborted()
  const {
    buffer: bytes,
    mediaType,
    pages,
    truncated,
  } = await decodeFileVisual({
    buffer,
    name: file.name,
    type: contentType,
    pages: typeof flags.pages === 'string' ? flags.pages : undefined,
    render: flags.render === true,
    signal: runtime.signal,
  })
  return {
    metadata: {
      fileId: file.id,
      name: file.name,
      path: workspaceFileVfsPath(file),
      type: file.type,
      mediaType,
      bytes: bytes.length,
      truncated,
      ...(pages ? { pages } : {}),
    },
    exitCode: 0,
    stderr: '',
    resources: [
      {
        op: 'upsert' as const,
        readOnly: true as const,
        resource: { type: 'file' as const, id: file.id, title: file.name },
      },
    ],
    observations: [
      {
        name: file.name,
        resourceId: file.id,
        mediaType,
        data: bytes.toString('base64'),
        ...(pages ? { pageCount: pages.last - pages.first + 1 } : {}),
      },
    ],
  }
}

/** Compatibility alias for explicit visual reads; new agent guidance uses files read. */
export const fileViewCommand: AgentCliEngine = {
  async execute(positionals, runtime, flags) {
    const reference = positionals[0]
    if (!reference) return agentCliFail('files view requires a workspace file reference.')
    try {
      const { metadata, ...result } = await readFileVisual(reference, runtime, flags)
      return { ...result, stdout: JSON.stringify({ ...metadata, id: metadata.fileId }) }
    } catch (error) {
      return fileReadFailure(error)
    }
  },
}
