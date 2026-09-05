import { z } from 'zod'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  awaitOciStreaming,
  executeOciStreamingOperation,
  OCI_STREAMING_ADMIN_ENDPOINT,
  OCI_STREAMING_SERVICE_ID,
  type OciStreamingSession,
  withOciStreamingBudget,
} from '@/lib/internal/oci-streaming/operations'
import {
  ociStreamingInputSchema,
  streamPoolSummarySchema,
  streamSummarySchema,
} from '@/lib/internal/oci-streaming/schema'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type OciStreamingSelectorKey = Extract<
  ServerSelectorKey,
  'oci_streaming.streamPools' | 'oci_streaming.streams'
>

interface PreparedStreamingDestination extends OciStreamingSession {
  credentialId: string
  scopeId: string
  pools: boolean
  deadline: number
}

function requireIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
    throw new SelectorContextUnavailableError()
  }
  return value.trim()
}

async function prepareStreamingDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedStreamingDestination> {
  const pools = args.selectorKey === 'oci_streaming.streamPools'
  const scopeId = requireIdentifier(pools ? args.context.compartmentId : args.context.streamPoolId)
  const access = args.credential?.access
  if (
    !access?.ok ||
    access.credentialType !== 'service_account' ||
    !access.resolvedCredentialId ||
    access.workspaceId !== args.workspaceId ||
    args.credential?.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const credentialId = access.resolvedCredentialId
  const deadline = Date.now() + 60_000
  return withOciStreamingBudget(
    async (budget) => {
      const client = await awaitOciStreaming(
        createOciClient({
          credentialId,
          workspaceId: args.workspaceId,
          serviceId: OCI_STREAMING_SERVICE_ID,
          region: args.context.ociRegion,
        }),
        budget.signal
      )
      budget.signal.throwIfAborted()
      const endpoint = await awaitOciStreaming(
        client.prepareStaticEndpoint(OCI_STREAMING_ADMIN_ENDPOINT),
        budget.signal
      )
      return { client, endpoint, credentialId, scopeId, pools, deadline }
    },
    args.signal,
    deadline
  )
}

function toOption(
  resource: z.infer<typeof streamPoolSummarySchema> | z.infer<typeof streamSummarySchema>
): SafeSelectorOption {
  return {
    id: resource.id,
    label: resource.name,
    meta: {
      lifecycleState: resource.lifecycleState,
      ...('partitions' in resource ? { partitions: resource.partitions } : {}),
      ...('isPrivate' in resource ? { isPrivate: resource.isPrivate ?? null } : {}),
    },
  }
}

async function executeStreamingSelector(
  args: ExecuteServerSelectorArgs,
  prepared: PreparedStreamingDestination
) {
  const { pools, scopeId, credentialId } = prepared
  const detailId = args.request.kind === 'detail' ? requireIdentifier(args.request.id) : undefined
  const input = ociStreamingInputSchema.parse({
    ociCredential: credentialId,
    ...(detailId
      ? {
          operation: pools ? 'get_stream_pool' : 'get_stream',
          [pools ? 'streamPoolId' : 'streamId']: detailId,
        }
      : {
          operation: pools ? 'list_stream_pools' : 'list_streams',
          [pools ? 'compartmentId' : 'streamPoolId']: scopeId,
          limit: 50,
          page: args.request.kind === 'list' ? args.request.cursor : undefined,
        }),
  })
  try {
    return await withOciStreamingBudget(
      async (budget) => {
        const result = await executeOciStreamingOperation(input, prepared, budget)
        const schema = pools ? streamPoolSummarySchema : streamSummarySchema
        const inScope = (resource: z.infer<typeof schema>) =>
          pools
            ? resource.compartmentId === scopeId
            : 'streamPoolId' in resource && resource.streamPoolId === scopeId
        if (detailId) {
          const resource = schema.parse(result.output[pools ? 'streamPool' : 'stream'])
          return detailSelectorResult(
            resource.id === detailId && inScope(resource) ? toOption(resource) : null
          )
        }
        const resources = z
          .array(schema)
          .max(50)
          .parse(result.output[pools ? 'streamPools' : 'streams'])
        if (!resources.every(inScope)) throw new SelectorOptionsUnavailableError()
        const nextPage = result.output.nextPage
        if (nextPage !== null && (typeof nextPage !== 'string' || nextPage.length > 1024)) {
          throw new SelectorOptionsUnavailableError()
        }
        return listSelectorResult(resources.map(toOption), nextPage ?? undefined)
      },
      args.signal,
      prepared.deadline
    )
  } catch (error) {
    if (detailId && error instanceof OciClientError && error.status === 404)
      return detailSelectorResult(null)
    throw error
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oci-streaming'],
} as const
const attachment = {
  credential,
  integrationBlockTypes: ['oci_streaming'],
  destination: { kind: 'credential-bound', prepare: prepareStreamingDestination },
  execute: executeStreamingSelector,
} as const

export const ociStreamingSelectorAttachments = {
  'oci_streaming.streamPools': definePreparedSelectorAttachment(attachment),
  'oci_streaming.streams': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<OciStreamingSelectorKey>
