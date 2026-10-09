import { v2ReadFileTextQuerySchema } from '@/lib/api/contracts/v2/files'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { fileReadFailure } from '@/lib/mothership/agent-cli/engines/file-view'
import { observePrivateFile } from '@/lib/mothership/agent-cli/engines/observe-private-file'
import { importProjectFileProvenance } from '@/lib/mothership/agent-cli/project-file-provenance'
import { agentCliFail } from '@/lib/mothership/agent-cli/types'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import type {
  AgentCliAugmentationInvocation,
  AgentCliRawResult,
} from '@/lib/mothership/generated/agent-cli'
import {
  readProjectFileArtifact,
  resolveProjectFileReference,
} from '@/lib/projects/files/application'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace'
import { MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_TEXT_EXTRACTION_BYTES, resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { fileOwnerVfsPath } from '@/lib/workspace-files/owner-paths'

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
    const { file, buffer, contentType, secretProvenance } = await executeCopilotProjectFileUseCase(
      context,
      readProjectFileArtifact,
      {
        ...target,
        maxBytes: query.data.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES,
        forModel: explicitVisual,
      },
      target
    )
    await importProjectFileProvenance(context.resolvedSecretTraceRegistry, secretProvenance)
    context.signal?.throwIfAborted()
    const type =
      resolveEffectiveMimeType(contentType, file.name).split(';')[0]?.trim().toLowerCase() ?? ''
    const visual =
      explicitVisual || (!textRange && (type.startsWith('image/') || type === 'application/pdf'))
    /** Default visual selection uses the authorized artifact's MIME, not earlier discovery metadata. */
    if (visual && (secretProvenance.status !== 'exact' || secretProvenance.entries.length !== 0))
      throw new OrchestrationError('forbidden', MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
    const result = await observePrivateFile(
      {
        buffer,
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
