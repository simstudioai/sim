import { describe, expect, it } from 'vitest'
import {
  credentialGroupAccessPolicySchema,
  credentialGroupAccessResponseSchema,
  credentialGroupEnrollmentDetailSchema,
  credentialGroupEnrollmentListQuerySchema,
  credentialGroupOAuthCallbackQuerySchema,
  credentialGroupSchema,
  inviteCredentialGroupEnrollmentsBodySchema,
  sharedCredentialGroupOAuthCallbackContract,
  updateCredentialGroupAccessBodySchema,
  updateCredentialGroupBodySchema,
  updateCredentialGroupMcpConnectorBodySchema,
  workspaceAccountsSettingsSchema,
} from '@/lib/api/contracts/credential-groups'
import {
  CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT,
} from '@/lib/credential-groups/limits'

describe('credential group contracts', () => {
  it('allows MCP source names while rejecting workspace account-container renaming', () => {
    expect(updateCredentialGroupBodySchema.safeParse({ name: 'Another group' }).success).toBe(false)
    expect(
      updateCredentialGroupBodySchema.safeParse({ description: 'Another group' }).success
    ).toBe(false)
    expect(
      updateCredentialGroupMcpConnectorBodySchema.parse({ name: 'Finance warehouse' })
    ).toEqual({
      name: 'Finance warehouse',
    })
  })

  it('represents missing workspace accounts as one nullable record, never a group list', () => {
    expect(
      workspaceAccountsSettingsSchema.parse({ credentialGroup: null, availableProviders: [] })
    ).toEqual({
      credentialGroup: null,
      availableProviders: [],
    })
    expect(
      workspaceAccountsSettingsSchema.safeParse({ credentialGroups: [], availableProviders: [] })
        .success
    ).toBe(false)
  })

  it('describes the shared managed OAuth callback as a redirect', () => {
    expect(sharedCredentialGroupOAuthCallbackContract.response).toEqual({ mode: 'redirect' })
  })

  it('accepts removing all account types', () => {
    const parsed = updateCredentialGroupBodySchema.parse({
      options: [],
    })

    expect(parsed.options).toEqual([])
  })

  it('accepts one option per provider after the group exists', () => {
    const parsed = updateCredentialGroupBodySchema.parse({
      options: [
        { provider: 'gmail', label: 'Gmail', required: true },
        { provider: 'google-calendar', label: 'Google Calendar', required: true },
        {
          provider: 'slack',
          label: 'Slack',
          required: true,
          slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    })

    expect(parsed.options).toHaveLength(3)
  })

  it('rejects the removed multiple-account option', () => {
    const result = updateCredentialGroupBodySchema.safeParse({
      options: [
        {
          provider: 'gmail',
          label: 'Primary inbox',
          required: true,
          allowMultiple: true,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate option labels case-insensitively', () => {
    const result = updateCredentialGroupBodySchema.safeParse({
      options: [
        {
          provider: 'gmail',
          label: 'Inbox',
          required: true,
        },
        {
          provider: 'gmail',
          label: 'inbox',
          required: true,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate providers', () => {
    const result = updateCredentialGroupBodySchema.safeParse({
      options: [
        { provider: 'gmail', label: 'Primary inbox', required: true },
        { provider: 'gmail', label: 'Escalations', required: true },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('allows Slack options without a workspace bot for organization personal authorization', () => {
    const missingApp = updateCredentialGroupBodySchema.safeParse({
      options: [
        {
          provider: 'slack',
          label: 'Slack',
          required: true,
        },
      ],
    })
    const withApp = updateCredentialGroupBodySchema.safeParse({
      options: [
        {
          provider: 'slack',
          label: 'Slack',
          required: true,
          slackBotCredentialId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    })

    expect(missingApp.success).toBe(true)
    expect(withApp.success).toBe(true)
  })

  it('rejects duplicate option IDs on update', () => {
    const option = {
      id: 'option-1',
      provider: 'gmail' as const,
      required: true,
    }
    const result = updateCredentialGroupBodySchema.safeParse({
      options: [
        { ...option, label: 'Inbox' },
        { ...option, label: 'Escalations' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects the authorization-app identity from settings responses', () => {
    const result = credentialGroupSchema.safeParse({
      id: 'group-1',
      workspaceId: 'workspace-1',
      description: null,
      options: [
        {
          id: 'option-1',
          provider: 'gmail',
          label: 'Inbox',
          required: true,
          status: 'active',
          authorizationAppId: 'server-only',
        },
      ],
      status: 'active',
      createdAt: '2026-08-10T12:00:00.000Z',
      updatedAt: '2026-08-10T12:00:00.000Z',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a batch of invitation emails', () => {
    const result = inviteCredentialGroupEnrollmentsBodySchema.parse({
      emails: ['alex@example.com', 'sam@example.com'],
    })

    expect(result.emails).toEqual(['alex@example.com', 'sam@example.com'])
  })

  it('rejects invitation batches larger than 100 recipients', () => {
    const result = inviteCredentialGroupEnrollmentsBodySchema.safeParse({
      emails: Array.from({ length: 101 }, (_, index) => `user-${index}@example.com`),
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid invitation email addresses', () => {
    const result = inviteCredentialGroupEnrollmentsBodySchema.safeParse({
      emails: ['not-an-email'],
    })

    expect(result.success).toBe(false)
  })

  it('bounds enrollment pages and defaults them to 50 rows', () => {
    expect(credentialGroupEnrollmentListQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(credentialGroupEnrollmentListQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
  })

  it('accepts aggregated provider connections on an enrollment', () => {
    const result = credentialGroupEnrollmentDetailSchema.parse({
      id: 'enrollment-1',
      credentialGroupId: 'group-1',
      email: 'alex@example.com',
      status: 'completed',
      expiresAt: '2026-08-18T12:00:00.000Z',
      invitedAt: '2026-08-11T12:00:00.000Z',
      sentAt: '2026-08-11T12:00:01.000Z',
      completedAt: '2026-08-11T12:05:00.000Z',
      revokedAt: null,
      expired: false,
      createdAt: '2026-08-11T12:00:00.000Z',
      updatedAt: '2026-08-11T12:05:00.000Z',
      connections: [{ provider: 'gmail', status: 'active', count: 2 }],
      mcpConnections: [{ mcpServerId: 'mcp-server-1', name: 'Fireflies', status: 'active' }],
    })

    expect(result.connections).toEqual([{ provider: 'gmail', status: 'active', count: 2 }])
    expect(result.mcpConnections).toEqual([
      { mcpServerId: 'mcp-server-1', name: 'Fireflies', status: 'active' },
    ])
  })

  it('accepts a bounded unique workflow access selection', () => {
    const result = updateCredentialGroupAccessBodySchema.parse({
      expectedRevision: 3,
      allowedWorkflowIds: ['workflow-1', 'workflow-2'],
    })

    expect(result.allowedWorkflowIds).toEqual(['workflow-1', 'workflow-2'])
  })

  it('requires the bounded workflow catalog only on access reads', () => {
    const access = { revision: 1, allowedWorkflowIds: ['workflow-1'] }

    expect(
      credentialGroupAccessResponseSchema.parse({
        ...access,
        workflows: [{ id: 'workflow-1', name: 'Support workflow' }],
      }).workflows
    ).toEqual([{ id: 'workflow-1', name: 'Support workflow' }])
    expect(credentialGroupAccessResponseSchema.safeParse(access).success).toBe(false)
    expect(
      credentialGroupAccessResponseSchema.safeParse({
        ...access,
        workflows: Array.from(
          { length: CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT + 1 },
          (_, index) => ({ id: `workflow-${index}`, name: `Workflow ${index}` })
        ),
      }).success
    ).toBe(false)
    expect(credentialGroupAccessPolicySchema.safeParse(access).success).toBe(true)
    expect(
      credentialGroupAccessPolicySchema.safeParse({
        ...access,
        workflows: [],
      }).success
    ).toBe(false)
  })

  it('rejects revision zero, duplicate workflows, oversized selections, and policy documents', () => {
    expect(
      updateCredentialGroupAccessBodySchema.safeParse({
        expectedRevision: 0,
        allowedWorkflowIds: [],
      }).success
    ).toBe(false)
    expect(
      updateCredentialGroupAccessBodySchema.safeParse({
        expectedRevision: 1,
        allowedWorkflowIds: ['workflow-1', 'workflow-1'],
      }).success
    ).toBe(false)
    expect(
      updateCredentialGroupAccessBodySchema.safeParse({
        expectedRevision: 1,
        allowedWorkflowIds: [' workflow-1'],
      }).success
    ).toBe(false)
    expect(
      updateCredentialGroupAccessBodySchema.safeParse({
        expectedRevision: 1,
        allowedWorkflowIds: ['   '],
      }).success
    ).toBe(false)
    expect(
      updateCredentialGroupAccessBodySchema.safeParse({
        expectedRevision: 1,
        allowedWorkflowIds: Array.from(
          { length: CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT + 1 },
          (_, index) => `workflow-${index}`
        ),
      }).success
    ).toBe(false)
    expect(
      updateCredentialGroupAccessBodySchema.safeParse({
        expectedRevision: 1,
        allowedWorkflowIds: [],
        document: { version: 1, resource: { type: 'credential_group', id: 'group-1' } },
      }).success
    ).toBe(false)
  })

  it('accepts an Atlassian-sized authorization code', () => {
    const parsed = credentialGroupOAuthCallbackQuerySchema.safeParse({
      state: `cg_${'a'.repeat(36)}`,
      code: 'a'.repeat(4096),
    })

    expect(parsed.success).toBe(true)
  })

  it('still rejects an unbounded authorization code', () => {
    const parsed = credentialGroupOAuthCallbackQuerySchema.safeParse({
      state: `cg_${'a'.repeat(36)}`,
      code: 'a'.repeat(8193),
    })

    expect(parsed.success).toBe(false)
  })
})
