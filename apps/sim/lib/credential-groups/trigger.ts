import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  credentialGroupWorkflowAccessPolicyCodec,
  decodeCredentialGroupWorkflowAccessPolicy,
} from '@/lib/credential-groups/application/workflow-access-policy'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import {
  CREDENTIAL_GROUP_EVENT_TRIGGER_ID,
  CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES,
  type CredentialGroupTriggerEventType,
} from '@/lib/credential-groups/trigger-constants'
import { fetchCredentialGroupTriggerSubscriptions } from '@/lib/credential-groups/trigger-subscriptions'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

const logger = createLogger('CredentialGroupTrigger')

interface CredentialGroupTriggerEventBase {
  workspaceId: string
  credentialGroupId: string
  credentialGroupName: string
  enrollmentId: string
  email: string
  enrollmentStatus: 'in_progress' | 'completed'
}

interface CredentialGroupTriggerCredential {
  credentialId: string
  credentialGroupOptionId: string
  provider: CredentialGroupProvider
  providerId: string
  displayName: string
}

export type CredentialGroupTriggerEvent =
  | (CredentialGroupTriggerEventBase & {
      event: 'credential_added' | 'credential_reconnected'
      credential: CredentialGroupTriggerCredential
    })
  | (CredentialGroupTriggerEventBase & {
      event: 'form_submitted'
      credential?: never
    })

export interface CredentialGroupTriggerPayload {
  event: CredentialGroupTriggerEventType
  timestamp: string
  credentialGroupId: string
  credentialGroupName: string
  enrollmentId: string
  email: string
  enrollmentStatus: 'in_progress' | 'completed'
  credentialId: string | null
  credentialGroupOptionId: string | null
  provider: CredentialGroupProvider | null
  providerId: string | null
  displayName: string | null
}

interface CredentialGroupTriggerConfig {
  triggerId: typeof CREDENTIAL_GROUP_EVENT_TRIGGER_ID
  eventType: CredentialGroupTriggerEventType
}

function parseCredentialGroupTriggerConfig(value: unknown): CredentialGroupTriggerConfig {
  if (!isRecordLike(value)) throw new Error('Credential Group trigger config must be an object')
  if (value.triggerId !== CREDENTIAL_GROUP_EVENT_TRIGGER_ID) {
    throw new Error('Credential Group trigger ID is invalid')
  }
  if (
    typeof value.eventType !== 'string' ||
    !(CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES as readonly string[]).includes(value.eventType)
  ) {
    throw new Error('Credential Group trigger event type is invalid')
  }
  return {
    triggerId: CREDENTIAL_GROUP_EVENT_TRIGGER_ID,
    eventType: value.eventType as CredentialGroupTriggerEventType,
  }
}

export function buildCredentialGroupTriggerPayload(
  event: CredentialGroupTriggerEvent
): CredentialGroupTriggerPayload {
  const credential = event.event === 'form_submitted' ? null : event.credential
  return {
    event: event.event,
    timestamp: new Date().toISOString(),
    credentialGroupId: event.credentialGroupId,
    credentialGroupName: event.credentialGroupName,
    enrollmentId: event.enrollmentId,
    email: event.email,
    enrollmentStatus: event.enrollmentStatus,
    credentialId: credential?.credentialId ?? null,
    credentialGroupOptionId: credential?.credentialGroupOptionId ?? null,
    provider: credential?.provider ?? null,
    providerId: credential?.providerId ?? null,
    displayName: credential?.displayName ?? null,
  }
}

/**
 * Fires deployed Credential Group triggers after the source mutation commits.
 * Delivery is restricted to workflows explicitly allowed by the group's resource policy.
 */
export async function fireCredentialGroupTrigger(
  event: CredentialGroupTriggerEvent
): Promise<void> {
  try {
    const policy = await requireResourcePolicy({
      workspaceId: event.workspaceId,
      resourceType: 'credential_group',
      resourceId: event.credentialGroupId,
      codec: credentialGroupWorkflowAccessPolicyCodec,
    })
    const allowedWorkflowIds = new Set(
      decodeCredentialGroupWorkflowAccessPolicy(policy.document, event.credentialGroupId)
    )
    if (allowedWorkflowIds.size === 0) return

    const subscriptions = await fetchCredentialGroupTriggerSubscriptions(event.workspaceId, [
      ...allowedWorkflowIds,
    ])
    const matchingSubscriptions = subscriptions.filter(({ webhook, workflow }) => {
      if (workflow.workspaceId !== event.workspaceId) return false
      if (!allowedWorkflowIds.has(workflow.id)) return false
      const config = parseCredentialGroupTriggerConfig(webhook.providerConfig)
      return config.eventType === event.event
    })
    if (matchingSubscriptions.length === 0) return

    const payload = buildCredentialGroupTriggerPayload(event)
    const { processPolledWebhookEvent } = await import('@/lib/webhooks/processor')
    for (const { webhook, workflow } of matchingSubscriptions) {
      const requestId = generateShortId()
      const result = await processPolledWebhookEvent(webhook, workflow, payload, requestId)
      if (!result.success) {
        logger.error(`[${requestId}] Failed to fire Credential Group trigger`, {
          event: event.event,
          credentialGroupId: event.credentialGroupId,
          subscriberWorkflowId: workflow.id,
          statusCode: result.statusCode,
          error: result.error,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to emit Credential Group event', {
      error,
      event: event.event,
      credentialGroupId: event.credentialGroupId,
      enrollmentId: event.enrollmentId,
    })
  }
}
