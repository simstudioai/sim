import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type PreparedOciNotificationsClient,
  prepareOciNotificationsClient,
} from '@/lib/internal/oci-notifications/endpoints'
import { executeOciNotificationsOperation } from '@/lib/internal/oci-notifications/operations'
import { ociNotificationsInputSchema } from '@/lib/internal/oci-notifications/schema'
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
import type {
  OciNotificationsSubscriptionSummary,
  OciNotificationsTopic,
} from '@/tools/oci_notifications/types'

type NotificationsSelectorKey = 'oci_notifications.topics' | 'oci_notifications.subscriptions'
interface PreparedNotificationsSelector {
  prepared: PreparedOciNotificationsClient
  credentialId: string
}

async function prepare(args: ExecuteServerSelectorArgs): Promise<PreparedNotificationsSelector> {
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
      serviceId: 'oci-notifications',
      region: args.context.region,
    })
    return {
      prepared: await prepareOciNotificationsClient(client),
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

function topicOption(topic: OciNotificationsTopic) {
  return { id: topic.topicId, label: topic.name, meta: { detail: topic.lifecycleState } }
}

function subscriptionOption(subscription: OciNotificationsSubscriptionSummary) {
  return {
    id: subscription.id,
    label: `${subscription.protocol}: ${subscription.id}`,
    meta: { detail: subscription.lifecycleState },
  }
}

async function execute(
  args: ExecuteServerSelectorArgs,
  destination: PreparedNotificationsSelector
) {
  const topics = args.selectorKey === 'oci_notifications.topics'
  const compartmentId = args.context.compartmentId?.trim()
  const topicId = args.context.topicId?.trim()
  if (!compartmentId || (!topics && !topicId)) throw new SelectorContextUnavailableError()
  const parsed = ociNotificationsInputSchema.safeParse({
    operation: topics
      ? args.request.kind === 'detail'
        ? 'oci_notifications_get_topic'
        : 'oci_notifications_list_topics'
      : args.request.kind === 'detail'
        ? 'oci_notifications_get_subscription'
        : 'oci_notifications_list_subscriptions',
    oauthCredential: destination.credentialId,
    region: args.context.region,
    compartmentId,
    topicId: topics && args.request.kind === 'detail' ? args.request.id : topicId,
    subscriptionId: !topics && args.request.kind === 'detail' ? args.request.id : undefined,
    limit: 50,
    page: args.request.kind === 'list' ? args.request.cursor : undefined,
  })
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const output = await executeOciNotificationsOperation(
      parsed.data,
      destination.prepared,
      args.signal
    )
    if (args.request.kind === 'detail') {
      if (topics) {
        const topic = output.topic
        return detailSelectorResult(
          topic && topic.topicId === args.request.id && topic.compartmentId === compartmentId
            ? topicOption(topic)
            : null
        )
      }
      const subscription = output.subscription
      return detailSelectorResult(
        subscription &&
          subscription.id === args.request.id &&
          subscription.compartmentId === compartmentId &&
          subscription.topicId === topicId
          ? subscriptionOption(subscription)
          : null
      )
    }
    return listSelectorResult(
      topics
        ? (output.topics ?? []).map(topicOption)
        : (output.subscriptions ?? []).map(subscriptionOption),
      output.nextPage
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) {
      if (error.code === 'credential_unavailable') throw new SelectorConnectionUnavailableError()
      if (error.status === 404 && args.request.kind === 'detail') return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status ?? 502)
    }
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oci-notifications'],
} as const
/** Service-account integrations declare the reached block independently of OAuth deployment. */
const integrationBlockTypes = ['oci_notifications'] as const

export const ociNotificationsSelectorAttachments = {
  'oci_notifications.topics': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
  'oci_notifications.subscriptions': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
} satisfies ServerSelectorAttachmentMap<NotificationsSelectorKey>
