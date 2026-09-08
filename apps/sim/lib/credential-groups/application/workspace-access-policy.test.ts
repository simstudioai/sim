/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildOrganizationAccountAccessPolicy,
  listOrganizationAccountWorkspaceIds,
  organizationAccountAccessPolicyCodec,
  organizationAccountPolicyAllowsWorkspace,
} from '@/lib/credential-groups/application/workspace-access-policy'

describe('organization account workspace policy', () => {
  it('denies every workspace by default', () => {
    const policy = buildOrganizationAccountAccessPolicy('group-1', [])
    expect(organizationAccountPolicyAllowsWorkspace(policy, 'workspace-1')).toBe(false)
  })

  it('grants only selected workspaces without a workflow or deployment condition', () => {
    const policy = buildOrganizationAccountAccessPolicy('group-1', ['workspace-2', 'workspace-1'])
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
      const policy = buildOrganizationAccountAccessPolicy('group-1', ['workspace-1'])
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
      buildOrganizationAccountAccessPolicy('group-1', ['workspace-1', 'workspace-1'])
    ).toThrow()
    expect(() => buildOrganizationAccountAccessPolicy('group-1', [' workspace-1 '])).toThrow()
  })
})
