import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim Clerk trigger IDs to their Clerk webhook event type.
 * Kept in sync with `matchEvent` in the `clerk` webhook provider.
 * Event-type strings are the canonical Clerk webhook event names
 * (see https://clerk.com/docs/guides/development/webhooks/overview).
 */
export const CLERK_TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  clerk_user_created: 'user.created',
  clerk_user_updated: 'user.updated',
  clerk_user_deleted: 'user.deleted',
  clerk_session_created: 'session.created',
  clerk_organization_created: 'organization.created',
  clerk_organization_membership_created: 'organizationMembership.created',
}

/**
 * Shared trigger dropdown options for all Clerk triggers.
 */
export const clerkTriggerOptions = [
  { label: 'User Created', id: 'clerk_user_created' },
  { label: 'User Updated', id: 'clerk_user_updated' },
  { label: 'User Deleted', id: 'clerk_user_deleted' },
  { label: 'Session Created', id: 'clerk_session_created' },
  { label: 'Organization Created', id: 'clerk_organization_created' },
  { label: 'Organization Membership Created', id: 'clerk_organization_membership_created' },
  { label: 'Generic Webhook (All Events)', id: 'clerk_webhook' },
]

/**
 * Generate setup instructions for a specific Clerk webhook event type.
 * Clerk webhooks are configured manually in the Clerk Dashboard, and the
 * Signing Secret must be pasted into the trigger configuration.
 */
export function clerkSetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'In the <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer">Clerk Dashboard</a>, go to <strong>Configure > Webhooks</strong> and click <strong>Add Endpoint</strong>.',
    'Paste the <strong>Webhook URL</strong> into the <strong>Endpoint URL</strong> field.',
    `Under <strong>Subscribe to events</strong>, select the <strong>${eventType}</strong> event, then click <strong>Create</strong>.`,
    'Open the endpoint you just created and copy its <strong>Signing Secret</strong> (starts with <code>whsec_</code>).',
    'Paste the <strong>Signing Secret</strong> into the field below.',
    'Click <strong>"Save Configuration"</strong> above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Build Clerk-specific extra fields.
 * Includes the Svix Signing Secret used to verify incoming webhook signatures.
 * Use with the generic buildTriggerSubBlocks from @/triggers.
 */
export function buildClerkExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'signingSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'whsec_...',
      description: 'Copy this from your Clerk webhook endpoint to verify event signatures.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Fields common to every Clerk webhook event payload
 * (see https://clerk.com/docs/guides/development/webhooks/overview).
 */
const commonEventOutputs: Record<string, TriggerOutput> = {
  type: { type: 'string', description: 'Event type (e.g., user.created, session.created)' },
  object: { type: 'string', description: 'Always "event"' },
  timestamp: { type: 'number', description: 'Timestamp in milliseconds when the event occurred' },
  instance_id: { type: 'string', description: 'Identifier of your Clerk instance' },
  data: {
    type: 'json',
    description: 'Raw event `data` object (shape varies by event type)',
  },
}

/**
 * Build outputs for `user.created` and `user.updated` events.
 * The `data` object is the Clerk User object.
 */
export function buildUserOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEventOutputs,
    userId: { type: 'string', description: 'Clerk user ID (data.id)' },
    firstName: { type: 'string', description: "User's first name" },
    lastName: { type: 'string', description: "User's last name" },
    username: { type: 'string', description: "User's username" },
    imageUrl: { type: 'string', description: 'Profile image URL' },
    primaryEmailAddressId: { type: 'string', description: 'Primary email address ID' },
    emailAddresses: { type: 'json', description: 'Array of email address objects' },
    phoneNumbers: { type: 'json', description: 'Array of phone number objects' },
    externalId: { type: 'string', description: 'External system ID linked to the user' },
    createdAt: { type: 'number', description: 'User creation timestamp (data.created_at)' },
    updatedAt: { type: 'number', description: 'User last update timestamp (data.updated_at)' },
  }
}

/**
 * Build outputs for `user.deleted` events.
 * The `data` object is a deleted-object marker: `{ id, deleted, object }`.
 */
export function buildUserDeletedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEventOutputs,
    userId: { type: 'string', description: 'Deleted Clerk user ID (data.id)' },
    deleted: { type: 'boolean', description: 'Whether the user was deleted (data.deleted)' },
  }
}

/**
 * Build outputs for `session.created` events.
 * The `data` object is the Clerk Session object.
 */
export function buildSessionOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEventOutputs,
    sessionId: { type: 'string', description: 'Clerk session ID (data.id)' },
    userId: { type: 'string', description: 'User the session belongs to (data.user_id)' },
    clientId: { type: 'string', description: 'Client ID for the session (data.client_id)' },
    status: { type: 'string', description: 'Session status (data.status)' },
    createdAt: { type: 'number', description: 'Session creation timestamp (data.created_at)' },
  }
}

/**
 * Build outputs for `organization.created` events.
 * The `data` object is the Clerk Organization object.
 */
export function buildOrganizationOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEventOutputs,
    organizationId: { type: 'string', description: 'Clerk organization ID (data.id)' },
    name: { type: 'string', description: 'Organization name (data.name)' },
    slug: { type: 'string', description: 'Organization slug (data.slug)' },
    createdBy: { type: 'string', description: 'User ID of the creator (data.created_by)' },
    membersCount: { type: 'number', description: 'Number of members (data.members_count)' },
    maxAllowedMemberships: {
      type: 'number',
      description: 'Maximum allowed memberships (data.max_allowed_memberships)',
    },
    createdAt: { type: 'number', description: 'Organization creation timestamp (data.created_at)' },
  }
}

/**
 * Build outputs for `organizationMembership.created` events.
 * The `data` object is the Clerk OrganizationMembership object.
 */
export function buildOrganizationMembershipOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEventOutputs,
    membershipId: { type: 'string', description: 'Membership ID (data.id)' },
    role: { type: 'string', description: 'Membership role, e.g. org:admin (data.role)' },
    organizationId: {
      type: 'string',
      description: 'Organization ID (data.organization.id)',
    },
    userId: {
      type: 'string',
      description: 'User ID of the member (data.public_user_data.user_id)',
    },
    createdAt: { type: 'number', description: 'Membership creation timestamp (data.created_at)' },
  }
}

/**
 * Build outputs for the generic webhook (all events).
 * Only the fields common to every Clerk event are guaranteed; use `data`
 * for event-specific fields.
 */
export function buildClerkOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEventOutputs,
  }
}

/**
 * Check if a Clerk event payload matches the expected trigger configuration.
 */
export function isClerkEventMatch(triggerId: string, body: Record<string, unknown>): boolean {
  const expectedType = CLERK_TRIGGER_TO_EVENT_TYPE[triggerId]
  if (!expectedType) {
    return true // Unknown trigger or generic webhook, allow through
  }
  return (body?.type as string | undefined) === expectedType
}
