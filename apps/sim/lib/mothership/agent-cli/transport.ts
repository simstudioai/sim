import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { createFileUploadTransport } from '@/lib/mothership/agent-cli/file-upload-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { createTableReadTransport } from '@/lib/mothership/agent-cli/table-read-transport'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import type { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import type { CopilotChatDelegationContext } from '@/lib/mothership/auth/application-delegation'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * The transport every Chat CLI invocation and augmentation engine reaches Sim through.
 *
 * Order is load-bearing: the file read layer sits outside in-process admission so every file
 * read and every other `GET` runs under a delivery observer that records the secret provenance
 * of the bytes, and resource effects observe what the composed stack returns.
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
  const reads = createFileReadTransport({
    endpoint,
    transport: createTableReadTransport({
      endpoint,
      transport: createTracedCliTransport(endpoint, createScopedCliTransport(endpoint, invocation)),
      registry,
    }),
    userId: invocation.userId,
    invocation,
    registry,
    ...(invocation.chatId !== undefined ? { chatId: invocation.chatId } : {}),
    ...(files ? { trackDownload: files.trackDownload } : {}),
  })
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
