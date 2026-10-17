import type { EmbeddedCliIdentity } from 'sim/embed'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { executePreparedCliRequest, prepareCliSession } from '@/lib/mothership/agent-cli/execute'
import { grepProjectFiles } from '@/lib/mothership/agent-cli/project-file-grep'
import { importProjectFileProvenance } from '@/lib/mothership/agent-cli/project-file-provenance'
import { readProjectFileForAgent } from '@/lib/mothership/agent-cli/project-file-read'
import { createProjectFileCliTransport } from '@/lib/mothership/agent-cli/project-file-transport'
import { createProjectFileUploadTransport } from '@/lib/mothership/agent-cli/project-file-upload-transport'
import { createProjectFileWriteTransport } from '@/lib/mothership/agent-cli/project-file-write-transport'
import { readOnlyCliTransport } from '@/lib/mothership/agent-cli/read-only'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { getProjectFileCapabilities } from '@/lib/projects/files/application'
import {
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { v2Error } from '@/app/api/v2/lib/response'

/** Executes the native command tree with Project-only transport and no ambient workspace target. */
export async function executeProjectFileCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext,
  projectId: string
): Promise<AgentCliRawResult> {
  if (request.curate)
    throw new OrchestrationError(
      'validation',
      'Project file commands do not support this projection'
    )
  const target = { projectId }
  await executeCopilotProjectFileUseCase(context, getProjectFileCapabilities, target, target)
  const { endpoint, sessionKey, files, resources } = prepareCliSession(context)
  const scoped = createProjectFileUploadTransport({
    endpoint,
    projectId,
    context,
    uploadProvenance: files?.uploadProvenance,
    fallback: createProjectFileWriteTransport({
      endpoint,
      projectId,
      context,
      fallback: createProjectFileCliTransport(endpoint, context, target),
    }),
  })
  const observed: typeof fetch = async (input, init) => {
    let provenance: WorkspaceFileSecretProvenance | undefined
    const response = await observeWorkspaceFileDelivery(
      async (source) => {
        provenance = source
        await importProjectFileProvenance(context.resolvedSecretTraceRegistry, source)
      },
      () => scoped(input, init)
    )
    if (response.ok && response.headers.has('Content-Disposition') && !provenance) {
      await response.body?.cancel()
      return v2Error('SERVICE_UNAVAILABLE', 'File read provenance is unavailable. Retry the read.')
    }
    /** Raw bytes reach the model unredacted unless a workbench tracker keeps them private. */
    if (
      !files &&
      response.headers.has('Content-Disposition') &&
      provenance?.status === 'exact' &&
      provenance.entries.length > 0
    ) {
      await response.body?.cancel()
      return v2Error('FORBIDDEN', MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
    }
    if (response.body && provenance) files?.trackDownload(response.body, provenance)
    return response
  }
  const transport = createResourceEffectTransport(
    endpoint,
    createTracedCliTransport(endpoint, observed),
    resources
  )
  const identity: EmbeddedCliIdentity = {
    endpoint,
    apiKey: 'mothership-in-process',
    /** Mutations are refused before the Project write and upload interceptors, as for workspaces. */
    transport: context.readOnly ? readOnlyCliTransport(transport) : transport,
    ...(context.signal ? { signal: context.signal } : {}),
  }
  return executePreparedCliRequest(request, {
    identity,
    sessionKey,
    files,
    resources,
    augment: (invocation) =>
      invocation.name === 'grep'
        ? grepProjectFiles(invocation, context, projectId)
        : readProjectFileForAgent(invocation, context, projectId),
  })
}
