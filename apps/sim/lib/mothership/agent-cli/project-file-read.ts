import { v2ReadFileTextQuerySchema } from '@/lib/api/contracts/v2/files'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { fileReadFailure } from '@/lib/mothership/agent-cli/engines/file-view'
import {
  isDefaultVisualMediaType,
  observePrivateFile,
  presentObservedText,
} from '@/lib/mothership/agent-cli/engines/observe-private-file'
import { importProjectFileProvenance } from '@/lib/mothership/agent-cli/project-file-provenance'
import { agentCliFail } from '@/lib/mothership/agent-cli/types'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import type {
  AgentCliAugmentationInvocation,
  AgentCliRawResult,
} from '@/lib/mothership/generated/agent-cli'
import {
  readProjectFileArtifact,
  readProjectFileText,
  resolveProjectFileReference,
} from '@/lib/projects/files/application'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace'
import {
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import {
  MAX_TEXT_EXTRACTION_BYTES,
  observedMediaType,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file'
import { normalizeMimeType } from '@/lib/uploads/utils/mime'
import { fileOwnerVfsPath } from '@/lib/workspace-files/owner-paths'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'

const projectReadQuerySchema = v2ReadFileTextQuerySchema.omit({ workspaceId: true })
const READ_FLAGS = new Set(['max-bytes', 'offset', 'limit', 'render', 'pages'])

/** Project observation reuses file decoders after canonical reference and exact-file authorization. */
export async function readProjectFileForAgent(
  invocation: AgentCliAugmentationInvocation,
  context: AgentCliExecutionContext,
  projectId: string
): Promise<AgentCliRawResult> {
  if (invocation.name !== 'files read' && invocation.name !== 'files view')
    return agentCliFail('This Project file operation is not supported.')
  const { flags, positionals } = invocation
  const reference = positionals[0]
  if (!reference || positionals.length !== 1)
    return agentCliFail('Project file reads require one file ID or Project file path.')
  for (const flag of Object.keys(flags)) {
    if (!READ_FLAGS.has(flag)) return agentCliFail(`Unsupported Project file read flag: --${flag}`)
  }
  for (const flag of ['max-bytes', 'offset', 'limit']) {
    if (flags[flag] === true) return agentCliFail(`--${flag} requires a value.`)
  }
  if (flags.render !== undefined && flags.render !== true)
    return agentCliFail('--render is a flag without a value.')
  if (flags.pages !== undefined && (typeof flags.pages !== 'string' || !flags.pages.trim()))
    return agentCliFail('--pages requires a page number or range.')
  const textRange = flags.offset !== undefined || flags.limit !== undefined
  const explicitVisual =
    invocation.name === 'files view' || flags.render === true || flags.pages !== undefined
  if (textRange && explicitVisual)
    return agentCliFail('Use text line ranges or visual page options in one read, not both.')
  const query = projectReadQuerySchema.safeParse({
    ...(flags['max-bytes'] !== undefined ? { maxBytes: flags['max-bytes'] } : {}),
    ...(flags.offset !== undefined ? { offset: flags.offset } : {}),
    ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
  })
  if (!query.success)
    return agentCliFail(query.error.issues.map((issue) => issue.message).join('; '))
  try {
    context.signal?.throwIfAborted()
    const resolved = await executeCopilotProjectFileUseCase(
      context,
      resolveProjectFileReference,
      { projectId, fileReference: reference },
      { projectId }
    )
    const target = { projectId, fileId: resolved.file.id }
    const maxBytes = query.data.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES
    /** A generated document is chosen by the type it renders to, as the workspace reader does. */
    const resolvedType = observedMediaType(resolved.file.type, resolved.file.name)
    /**
     * Text reads admit the file as `complete`, so the registry masks its secrets as it does for a
     * workspace file; only visual and undecodable reads take its stored bytes, which no redaction
     * reaches. Images and PDFs default to visual unless a line range asks for their text.
     */
    const readsText =
      !explicitVisual &&
      Boolean(workspaceFileTextFormat({ name: resolved.file.name, type: resolvedType })) &&
      (textRange || !isDefaultVisualMediaType(resolvedType))
    let file: typeof resolved.file
    let result: Awaited<ReturnType<typeof observePrivateFile>>
    if (readsText) {
      const read = await executeCopilotProjectFileUseCase(
        context,
        readProjectFileText,
        { ...target, maxBytes, offset: query.data.offset, limit: query.data.limit },
        target
      )
      await importProjectFileProvenance(context.resolvedSecretTraceRegistry, read.secretProvenance)
      context.signal?.throwIfAborted()
      file = read.file
      result = presentObservedText(
        {
          name: file.name,
          path: fileOwnerVfsPath(file.owner, workspaceFileVfsPath(file)),
          type: normalizeMimeType(resolveEffectiveMimeType(read.contentType, file.name)),
          source: 'project',
          fileId: file.id,
        },
        read
      )
    } else {
      const artifact = await executeCopilotProjectFileUseCase(
        context,
        readProjectFileArtifact,
        { ...target, maxBytes, forModel: explicitVisual },
        target
      )
      await importProjectFileProvenance(
        context.resolvedSecretTraceRegistry,
        artifact.secretProvenance
      )
      context.signal?.throwIfAborted()
      file = artifact.file
      // Default visual selection uses the authorized artifact's MIME, not earlier discovery metadata.
      const type = normalizeMimeType(resolveEffectiveMimeType(artifact.contentType, file.name))
      const visual = explicitVisual || (!textRange && isDefaultVisualMediaType(type))
      if (visual && hasPossibleSecrets(artifact.secretProvenance))
        throw new OrchestrationError('forbidden', MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
      result = await observePrivateFile(
        {
          buffer: artifact.buffer,
          name: file.name,
          contentType: type,
          fileId: file.id,
          path: fileOwnerVfsPath(file.owner, workspaceFileVfsPath(file)),
          source: 'project',
        },
        flags,
        { ...query.data, visual },
        context.signal
      )
    }
    const resource = {
      type: 'file' as const,
      id: file.id,
      title: file.name,
      owner: { entityType: 'project' as const, entityId: projectId },
    }
    return {
      ...result,
      ...(result.observations
        ? {
            observations: result.observations.map((observation) => ({
              ...observation,
              resource,
            })),
          }
        : {}),
      resources: [
        {
          op: 'upsert',
          readOnly: true,
          resource,
        },
      ],
    }
  } catch (error) {
    return fileReadFailure(error)
  }
}

/** A rendered image would bypass text redaction, so only provenance known to hold no secret passes. */
function hasPossibleSecrets(provenance: WorkspaceFileSecretProvenance) {
  return (
    provenance.status === 'unknown' ||
    (provenance.status === 'exact' && provenance.entries.length > 0)
  )
}
