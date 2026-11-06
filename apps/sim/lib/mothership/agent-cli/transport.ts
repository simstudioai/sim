import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { createFileUploadTransport } from '@/lib/mothership/agent-cli/file-upload-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import type { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import type { CopilotChatDelegationContext } from '@/lib/mothership/auth/application-delegation'
import {
  createRegistryContentGate,
  deliveredFileProvenance,
  dispatchUnderContentGate,
} from '@/lib/mothership/content-delivery'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * The transport every Chat CLI invocation and augmentation engine reaches Sim through.
 *
 * Every request, whatever its method, runs under a gate bound to the invocation's registry: each
 * stored item a use case returns is admitted on its own, its secrets imported for redaction, and a
 * `sourced` route that classified nothing is refused. Resource effects observe the gated result,
 * and a workbench copy of delivered bytes keeps the classification of what was admitted.
 */
export function createAgentCliTransport(context: {
  endpoint: string
  invocation: CopilotChatDelegationContext & { workspaceId: string }
  registry?: ResolvedSecretTraceRegistry
  files?: ReturnType<typeof createWorkbenchFileProvenance>
  resources: ResourceChange[]
  observeReads: boolean
}): typeof fetch {
  const { endpoint, invocation, registry, files } = context
  const gate = createRegistryContentGate({
    registry,
    workspaceId: invocation.workspaceId,
    actorUserId: invocation.userId,
  })
  const routes = createFileReadTransport({
    endpoint,
    transport: createTracedCliTransport(endpoint, createScopedCliTransport(endpoint, invocation)),
    invocation,
    registry,
    tracksWorkbenchDownloads: Boolean(files),
  })
  const reads: typeof fetch = async (input, init) => {
    const { response, admitted } = await dispatchUnderContentGate(gate, () => routes(input, init))
    if (files && admitted.length > 0 && response.body) {
      files.trackDownload(response.body, deliveredFileProvenance(admitted))
    }
    return response
  }
  return createResourceEffectTransport(
    endpoint,
    files
      ? createFileUploadTransport({
          endpoint,
          workspaceId: invocation.workspaceId,
          userId: invocation.userId,
          invocation,
          fallback: reads,
          uploadProvenance: files.uploadProvenance,
        })
      : reads,
    context.resources,
    context.observeReads
  )
}
