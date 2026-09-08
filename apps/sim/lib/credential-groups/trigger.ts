import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  requireOrganizationAccountsWorkspaceAccess,
  resolveOrganizationAccountsWorkspaceContext,
} from '@/lib/credential-groups/application/organization-workspace-access'
import {
  listOrganizationAccountWorkspaceIds,
  organizationAccountAccessPolicyCodec,
} from '@/lib/credential-groups/application/workspace-access-policy'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import {
  CREDENTIAL_GROUP_EVENT_TRIGGER_ID,
  CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES,
  type CredentialGroupTriggerEventType,
} from '@/lib/credential-groups/trigger-constants'
import { fetchCredentialGroupTriggerSubscriptions } from '@/lib/credential-groups/trigger-subscriptions'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

interface CredentialGroupTriggerEventBase {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  credentialGroupName: string
  enrollmentId: string
  email: string
  enrollmentStatus: 'in_progress' | 'completed'
}

interface CredentialGroupTriggerCredential {
  credentialId: string
  credentialGroupOptionId: string | null
  mcpServerId?: string
  provider: CredentialGroupProvider | ManagedMcpConnectorId
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
  mcpServerId: string | null
  provider: CredentialGroupProvider | ManagedMcpConnectorId | null
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
    mcpServerId: credential?.mcpServerId ?? null,
    provider: credential?.provider ?? null,
    providerId: credential?.providerId ?? null,
    displayName: credential?.displayName ?? null,
  }
}

/**
 * Fires deployed Credential Group triggers after the source mutation commits.
 * Delivery requires an opted-in deployed Credential trigger and current organization workspace access.
 */
export async function fireCredentialGroupTrigger(
  event: CredentialGroupTriggerEvent
): Promise<void> {
  if (!event.organizationId) return
  const policy = await requireResourcePolicy({
    organizationId: event.organizationId,
    resourceType: 'credential_group',
    resourceId: event.credentialGroupId,
    codec: organizationAccountAccessPolicyCodec,
  })
  const allowedWorkspaceIds = listOrganizationAccountWorkspaceIds(policy.document)
  if (allowedWorkspaceIds.length === 0) return
  const subscriptions = await fetchCredentialGroupTriggerSubscriptions(
    event.organizationId,
    allowedWorkspaceIds
  )
  const matchingSubscriptions = subscriptions.filter(({ webhook }) => {
    const config = parseCredentialGroupTriggerConfig(webhook.providerConfig)
    return config.eventType === event.event
  })
  if (matchingSubscriptions.length === 0) return

  const payload = buildCredentialGroupTriggerPayload(event)
  const { processPolledWebhookEvent } = await import('@/lib/webhooks/processor')
  for (const { webhook, workflow } of matchingSubscriptions) {
    if (!workflow.workspaceId) throw new Error('Subscribed workflow is missing its workspace')
    try {
      const context = await resolveOrganizationAccountsWorkspaceContext(workflow.workspaceId)
      if (context.credentialGroupId !== event.credentialGroupId || context.status !== 'active')
        continue
      await requireOrganizationAccountsWorkspaceAccess(context)
    } catch (error) {
      /** Revocations and workspace moves remove subscribers between discovery and delivery. */
      if (
        error instanceof OrchestrationError &&
        (error.code === 'forbidden' || error.code === 'not_found')
      )
        continue
      throw error
    }
    const requestId = generateShortId()
    const result = await processPolledWebhookEvent(webhook, workflow, payload, requestId)
    if (!result.success) {
      throw new Error(
        `Failed to deliver connected account event to workflow ${workflow.id}: ${result.error ?? result.statusCode}`
      )
    }
  }
}
