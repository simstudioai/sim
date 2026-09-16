/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildOrganizationAccountAccessPolicy,
  listOrganizationAccountWorkspaceGrants,
  listOrganizationAccountWorkspaceIds,
  organizationAccountAccessPolicyCodec,
  organizationAccountPolicyAllowsWorkspace,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { organizationAccountWorkspaceGrantsSchema } from '@/lib/credential-groups/workspace-grants'

describe('organization account workspace policy', () => {
  it('denies every workspace by default', () => {
    const policy = buildOrganizationAccountAccessPolicy('group-1', [])
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'workspace-1')).toBe(false)
  })

  it('grants only selected workspaces without a workflow or deployment condition', () => {
    const policy = buildOrganizationAccountAccessPolicy(
      'group-1',
      ['workspace-2', 'workspace-1'].map((workspaceId) => ({
        workspaceId,
        access: { mode: 'all' as const },
      }))
    )
    expect(listOrganizationAccountWorkspaceIds(policy)).toEqual(['workspace-1', 'workspace-2'])
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'workspace-1')).toBe(true)
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'workspace-3')).toBe(false)
    expect(policy.statements[0]).not.toHaveProperty('condition')
  })

  it('rejects policies naming a different group', () => {
    expect(() =>
      organizationAccountAccessPolicyCodec.parse(
        buildOrganizationAccountAccessPolicy('group-2', []),
        { type: 'credential_group', id: 'group-1' }
      )
    ).toThrow('canonical group')
  })

  it('rejects workflow grants and indexing grants', () => {
    for (const principal of [
      { type: 'workflow', workflowId: 'workflow-1' },
      { type: 'knowledge_connector', connectorId: 'connector-1' },
    ]) {
      const policy = buildOrganizationAccountAccessPolicy(
        'group-1',
        ['workspace-1'].map((workspaceId) => ({ workspaceId, access: { mode: 'all' as const } }))
      )
      expect(() =>
        organizationAccountAccessPolicyCodec.parse(
          { ...policy, statements: [{ ...policy.statements[0], principals: [principal] }] },
          { type: 'credential_group', id: 'group-1' }
        )
      ).toThrow()
    }
  })

  it('rejects duplicate selections and malformed IDs', () => {
    expect(() =>
      buildOrganizationAccountAccessPolicy(
        'group-1',
        ['workspace-1', 'workspace-1'].map((workspaceId) => ({
          workspaceId,
          access: { mode: 'all' as const },
        }))
      )
    ).toThrow()
    expect(() =>
      buildOrganizationAccountAccessPolicy(
        'group-1',
        [' workspace-1 '].map((workspaceId) => ({ workspaceId, access: { mode: 'all' as const } }))
      )
    ).toThrow()
  })
})

describe('integration-specific organization grants', () => {
  const grants = [
    {
      workspaceId: 'mail-workspace',
      access: {
        mode: 'selected' as const,
        credentialTypes: ['oauth:gmail' as const, 'mcp:fireflies' as const],
      },
    },
    {
      workspaceId: 'calendar-workspace',
      access: {
        mode: 'selected' as const,
        credentialTypes: ['oauth:google-calendar' as const, 'personal_token:gitlab' as const],
      },
    },
    { workspaceId: 'all-workspace', access: { mode: 'all' as const } },
  ]
  const policy = buildOrganizationAccountAccessPolicy('group-1', grants)

  it('evaluates type and workspace together across OAuth, MCP, and personal tokens', () => {
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'mail-workspace', 'oauth:gmail')).toBe(
      true
    )
    expect(
      organizationAccountPolicyAllowsWorkspace(policy, 'mail-workspace', 'oauth:google-calendar')
    ).toBe(false)
    expect(
      organizationAccountPolicyAllowsWorkspace(policy, 'mail-workspace', 'mcp:fireflies')
    ).toBe(true)
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'mail-workspace', 'mcp:granola')).toBe(
      false
    )
    expect(
      organizationAccountPolicyAllowsWorkspace(
        policy,
        'calendar-workspace',
        'personal_token:gitlab'
      )
    ).toBe(true)
    expect(
      organizationAccountPolicyAllowsWorkspace(policy, 'mail-workspace', 'personal_token:gitlab')
    ).toBe(false)
    expect(
      organizationAccountPolicyAllowsWorkspace(policy, 'unknown-workspace', 'oauth:gmail')
    ).toBe(false)
  })

  it('keeps all-integration grants unconditional and round-trips selected grants', () => {
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'all-workspace', 'oauth:zoom')).toBe(
      true
    )
    expect(
      policy.statements.find((statement) => statement.sid === 'WorkspaceCredentialAccess')
    ).not.toHaveProperty('condition')
    const restored = listOrganizationAccountWorkspaceGrants(policy)
    for (const grant of grants) {
      const match = restored.find((value) => value.workspaceId === grant.workspaceId)
      expect(match?.access.mode).toBe(grant.access.mode)
      if (grant.access.mode === 'selected' && match?.access.mode === 'selected') {
        expect(new Set(match.access.credentialTypes)).toEqual(new Set(grant.access.credentialTypes))
      }
    }
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'mail-workspace')).toBe(true)
  })

  it('fails closed for unknown types, duplicate types, and empty selections', () => {
    for (const types of [[], ['oauth:unknown'], ['oauth:gmail', 'oauth:gmail']]) {
      expect(
        organizationAccountWorkspaceGrantsSchema.safeParse([
          { workspaceId: 'mail-workspace', access: { mode: 'selected', credentialTypes: types } },
        ]).success
      ).toBe(false)
      expect(() =>
        organizationAccountAccessPolicyCodec.parse(
          {
            ...policy,
            statements: [
              {
                ...policy.statements.find((statement) => statement.condition),
                condition: { StringEquals: { 'credential_group:CredentialType': types } },
              },
            ],
          },
          { type: 'credential_group', id: 'group-1' }
        )
      ).toThrow()
    }
  })

  it('rejects ambiguous overlapping or duplicate statements', () => {
    const selected = policy.statements.find((statement) => statement.condition)!
    const unrestricted = policy.statements.find((statement) => !statement.condition)!
    for (const statements of [
      [selected, selected],
      [selected, { ...unrestricted, principals: selected.principals }],
      [{ ...selected, sid: 'WorkspaceCredentialAccess:oauth:unknown' }],
    ]) {
      expect(() =>
        organizationAccountAccessPolicyCodec.parse(
          { ...policy, statements },
          { type: 'credential_group', id: 'group-1' }
        )
      ).toThrow()
    }
  })
})
