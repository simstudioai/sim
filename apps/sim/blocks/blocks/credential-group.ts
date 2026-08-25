import { GridOffset } from '@sim/emcn/icons'
import {
  type CanonicalGroup,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { BlockConfig } from '@/blocks/types'
import {
  CREDENTIAL_GROUP_LIST_STALE_TIME,
  credentialGroupKeys,
  fetchCredentialGroupList,
} from '@/hooks/queries/utils/credential-group-queries'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const CREDENTIAL_GROUP_CANONICAL_GROUP = {
  canonicalId: 'credentialGroupId',
  basicId: 'credentialGroup',
  advancedIds: ['manualCredentialGroup'],
} as const satisfies CanonicalGroup

/**
 * Reads the workspace credential-group list through the shared cache entry every
 * consumer observes. The fetch stays bound to React Query's own signal: a caller's
 * signal belongs to that caller alone, and forwarding it here would abort a request
 * other observers of this workspace-wide key are awaiting.
 */
async function fetchCachedCredentialGroups() {
  const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
  if (!workspaceId) return []

  return getQueryClient().fetchQuery({
    queryKey: credentialGroupKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchCredentialGroupList(workspaceId, signal),
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
  })
}

function resolveCredentialGroupIdForBlock(blockId: string): string | null {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) return null
  const values = useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId] ?? {}
  const canonicalModes = useWorkflowStore.getState().blocks[blockId]?.data?.canonicalModes
  const value = resolveActiveCanonicalValue(
    CREDENTIAL_GROUP_CANONICAL_GROUP,
    values,
    canonicalModes
  )
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

interface CredentialGroupBlockOutput {
  success: boolean
  output: {
    credentials: Array<{
      credentialId: string
      email: string
      displayName: string
      providerId: string
      providerSubjectId: string
      providerTenantId: string | null
    }>
    credentialGroups: Array<{
      id: string
      name: string
      description: string | null
      status: 'active' | 'disabled'
      providerIds: string[]
      createdAt: string
      updatedAt: string
    }>
    people: Array<{
      id: string
      email: string
      status: string
      expired: boolean
      invitedAt: string
      connections: Array<{ provider: string; status: string; count: number }>
    }>
    enrollmentId: string
    email: string
    status: string
    invitedAt: string
    expiresAt: string
    invitationLink: string
    count: number
    hasMore: boolean
    nextCursor: string | null
  }
}

const INVITE_OPERATIONS = ['send_invite', 'get_invite_link'] as const
const GROUP_OPERATIONS = ['list_credentials', ...INVITE_OPERATIONS, 'list_people'] as const
const LIST_OPERATIONS = ['list_credentials', 'list_people', 'list_groups'] as const

export const CredentialGroupBlock: BlockConfig<CredentialGroupBlockOutput> = {
  type: 'credential_group',
  name: 'Credential Groups',
  description: 'Invite people and use credentials collected by Credential Groups',
  longDescription:
    'List usable managed credentials, inspect invited people, send or generate an account-connection invitation, or discover Credential Groups in the current workspace. The block returns credential IDs and account metadata without exposing OAuth tokens.',
  bestPractices: `
  - Use "List Credentials" with a ForEach loop to run a provider block once for every connected account.
  - Filter by email to select credentials belonging to one invited person, by provider to select one account type, or by both for an exact match.
  - Continue with nextCursor until hasMore is false when a list operation returns multiple pages.
  - "List Credentials" returns active, usable credentials only. Reconnect-needed and revoked credentials are excluded.
  - Use "List People" to inspect invitation and connection progress without exposing credential secrets.
  - "Send Invite" sends one email. Use a loop when invitations should come from a dynamic list.
  - "Get Invite Link" issues a fresh seven-day bearer link without sending email. It invalidates the previous link for that email, so treat the output as a secret.
  `,
  docsLink: 'https://docs.sim.ai/workflows/blocks/credential-group',
  bgColor: '#8B5CF6',
  icon: GridOffset,
  canvasPresentation: {
    defaultTitle: 'Credential Groups',
    sentences: {
      byOperation: {
        list_credentials: [
          {
            text: 'List credentials from',
            field: ['credentialGroup', 'manualCredentialGroup'],
            core: true,
          },
          { text: ', for', field: 'email' },
          { text: ', from', field: ['providerFilter', 'manualProviderIds'] },
          { text: ', up to', field: 'limit', after: 'credentials' },
        ],
        send_invite: [
          { text: 'Invite', field: 'email', core: true },
          {
            text: 'to',
            field: ['credentialGroup', 'manualCredentialGroup'],
            core: true,
          },
        ],
        get_invite_link: [
          { text: 'Get invite link for', field: 'email', core: true },
          {
            text: 'in',
            field: ['credentialGroup', 'manualCredentialGroup'],
            core: true,
          },
        ],
        list_people: [
          {
            text: 'List people in',
            field: ['credentialGroup', 'manualCredentialGroup'],
            core: true,
          },
          { text: ', matching', field: 'email' },
          { text: ', with status', field: 'peopleStatuses' },
        ],
        list_groups: ['List Credential Groups', { text: ', up to', field: 'limit' }],
      },
    },
  },
  category: 'blocks',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Credentials', id: 'list_credentials' },
        { label: 'Send Invite', id: 'send_invite' },
        { label: 'Get Invite Link', id: 'get_invite_link' },
        { label: 'List People', id: 'list_people' },
        { label: 'List Credential Groups', id: 'list_groups' },
      ],
      value: () => 'list_credentials',
    },
    {
      id: 'credentialGroup',
      title: 'Credential Group',
      type: 'dropdown',
      selectorKey: 'workspace.credentialGroups',
      required: { field: 'operation', value: [...GROUP_OPERATIONS] },
      mode: 'basic',
      canonicalParamId: 'credentialGroupId',
      condition: { field: 'operation', value: [...GROUP_OPERATIONS] },
    },
    {
      id: 'manualCredentialGroup',
      title: 'Credential Group ID',
      type: 'short-input',
      required: { field: 'operation', value: [...GROUP_OPERATIONS] },
      mode: 'advanced',
      placeholder: 'Enter credential group ID',
      canonicalParamId: 'credentialGroupId',
      condition: { field: 'operation', value: [...GROUP_OPERATIONS] },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      required: { field: 'operation', value: [...INVITE_OPERATIONS] },
      placeholder: 'person@example.com',
      condition: { field: 'operation', value: [...GROUP_OPERATIONS] },
    },
    {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      selectorKey: 'workspace.credentialGroupProviders',
      multiSelect: true,
      emptyIsValid: true,
      required: false,
      mode: 'basic',
      canonicalParamId: 'credentialProviderIds',
      dependsOn: ['credentialGroupId'],
      condition: { field: 'operation', value: 'list_credentials' },
    },
    {
      id: 'manualProviderIds',
      title: 'Provider IDs',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      canonicalParamId: 'credentialProviderIds',
      dependsOn: ['credentialGroupId'],
      placeholder: '["google-email", "slack"] — leave empty for all providers',
      condition: { field: 'operation', value: 'list_credentials' },
    },
    {
      id: 'peopleStatuses',
      title: 'Status',
      type: 'dropdown',
      multiSelect: true,
      emptyIsValid: true,
      options: [
        { label: 'Invited', id: 'invited' },
        { label: 'Delivery failed', id: 'delivery_failed' },
        { label: 'In progress', id: 'in_progress' },
        { label: 'Connected', id: 'completed' },
        { label: 'Revoked', id: 'revoked' },
      ],
      condition: { field: 'operation', value: 'list_people' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      value: () => '100',
      mode: 'advanced',
      placeholder: '1-100',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'nextCursor from a previous page',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
  ],
  tools: { access: [] },
  inputs: {
    operation: {
      type: 'string',
      description:
        "'list_credentials', 'send_invite', 'get_invite_link', 'list_people', or 'list_groups'",
    },
    credentialGroupId: { type: 'string', description: 'Credential Group ID' },
    email: {
      type: 'string',
      description: 'Recipient email for invites or exact email filter for list operations',
    },
    credentialProviderIds: {
      type: 'json',
      description: 'Optional OAuth provider IDs to include when listing credentials',
    },
    peopleStatuses: {
      type: 'json',
      description: 'Optional invitation statuses to include when listing people',
    },
    limit: { type: 'number', description: 'Maximum results per page (1-100)' },
    cursor: { type: 'string', description: 'nextCursor from a previous page' },
  },
  outputs: {
    credentials: {
      type: 'json',
      description:
        'Usable credential references (credentialId, email, displayName, providerId, providerSubjectId, providerTenantId)',
      condition: { field: 'operation', value: 'list_credentials' },
    },
    credentialGroups: {
      type: 'json',
      description:
        'Credential Group summaries (id, name, description, status, providerIds, createdAt, updatedAt)',
      condition: { field: 'operation', value: 'list_groups' },
    },
    people: {
      type: 'json',
      description:
        'Invited people and current connection summaries (id, email, status, expired, invitedAt, connections)',
      condition: { field: 'operation', value: 'list_people' },
    },
    enrollmentId: {
      type: 'string',
      description: 'Enrollment ID created or refreshed by the invitation',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    email: {
      type: 'string',
      description: 'Normalized invitation recipient email',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    status: {
      type: 'string',
      description: 'Invitation status',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    invitedAt: {
      type: 'string',
      description: 'Invitation timestamp',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    expiresAt: {
      type: 'string',
      description: 'Invitation expiration timestamp',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    invitationLink: {
      type: 'string',
      description: 'Fresh bearer invitation link for the recipient',
      condition: { field: 'operation', value: 'get_invite_link' },
    },
    count: {
      type: 'number',
      description: 'Number of records returned',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page is available',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
  },
}
