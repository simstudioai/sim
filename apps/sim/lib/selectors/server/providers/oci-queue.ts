import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type PreparedOciQueueClient,
  prepareOciQueueClient,
} from '@/lib/internal/oci-queue/endpoints'
import { executeOciQueueOperation } from '@/lib/internal/oci-queue/operations'
import { ociQueueInputSchema } from '@/lib/internal/oci-queue/schema'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { OciQueueSummary } from '@/tools/oci_queue/types'

type OciQueueSelectorKey = 'oci_queue.queues' | 'oci_queue.channels'
interface PreparedQueueSelector {
  prepared: PreparedOciQueueClient
  credentialId: string
}

async function prepare(args: ExecuteServerSelectorArgs): Promise<PreparedQueueSelector> {
  args.signal?.throwIfAborted()
  const access = args.credential?.access
  if (
    !access?.ok ||
    !access.resolvedCredentialId ||
    access.credentialType !== 'service_account' ||
    access.workspaceId !== args.workspaceId ||
    args.credential?.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  try {
    const client = await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: args.workspaceId,
      serviceId: 'oci-queue',
      region: args.context.region,
    })
    return {
      prepared: await prepareOciQueueClient(client),
      credentialId: access.resolvedCredentialId,
    }
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError && error.code === 'invalid_endpoint') {
      throw new SelectorContextUnavailableError()
    }
    throw new SelectorConnectionUnavailableError()
  }
}

function queueOption(queue: OciQueueSummary) {
  return {
    id: queue.id,
    label: queue.displayName || queue.id,
    meta: { detail: queue.lifecycleState },
  }
}

async function execute(args: ExecuteServerSelectorArgs, destination: PreparedQueueSelector) {
  const queues = args.selectorKey === 'oci_queue.queues'
  const scope = queues ? args.context.compartmentId : args.context.queueId
  if (!scope?.trim()) throw new SelectorContextUnavailableError()
  if (!queues && args.request.kind === 'detail') throw new SelectorOptionsUnavailableError()
  const parsed = ociQueueInputSchema.safeParse({
    operation: queues
      ? args.request.kind === 'detail'
        ? 'oci_queue_get_queue'
        : 'oci_queue_list_queues'
      : 'oci_queue_list_channels',
    oauthCredential: destination.credentialId,
    region: args.context.region,
    compartmentId: args.context.compartmentId,
    queueId: queues && args.request.kind === 'detail' ? args.request.id : args.context.queueId,
    consumerGroupId: args.context.consumerGroupId,
    limit: 100,
    page: args.request.kind === 'list' ? args.request.cursor : undefined,
  })
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const output = await executeOciQueueOperation(parsed.data, destination.prepared, args.signal)
    if (queues && args.request.kind === 'detail') {
      const queue = output.queue
      return detailSelectorResult(
        queue && queue.id === args.request.id && queue.compartmentId === scope.trim()
          ? queueOption(queue)
          : null
      )
    }
    return listSelectorResult(
      queues
        ? (output.queues ?? []).map(queueOption)
        : (output.channels ?? []).map((id) => ({ id, label: id })),
      output.nextPage
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) {
      if (error.code === 'credential_unavailable') throw new SelectorConnectionUnavailableError()
      if (error.status === 404 && queues && args.request.kind === 'detail') {
        return detailSelectorResult(null)
      }
      throw selectorProviderStatusError(error.status ?? 502)
    }
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci-queue'] } as const
/**
 * Service-account integrations have no OAuth deployment catalog mapping; declare the reached block.
 */
const integrationBlockTypes = ['oci_queue'] as const

export const ociQueueSelectorAttachments = {
  'oci_queue.queues': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
  'oci_queue.channels': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
} satisfies ServerSelectorAttachmentMap<OciQueueSelectorKey>
