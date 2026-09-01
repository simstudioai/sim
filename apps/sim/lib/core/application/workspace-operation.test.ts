/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION } from '@/lib/resource-policies/registry'

describe('defineWorkspaceOperation delegated service policy', () => {
  it('preserves and freezes an explicit delegated service allowlist', () => {
    const operation = defineWorkspaceOperation({
      id: 'test.read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['copilot', 'executor'],
    })

    expect(operation.delegatedServices).toEqual(['copilot', 'executor'])
    expect(Object.isFrozen(operation.delegatedServices)).toBe(true)
  })

  it('fails fast when delegated principals have no service policy', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'test.missing_service_policy',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['delegated'],
      } as never)
    ).toThrow('Operation test.missing_service_policy has inconsistent delegated service policy')
  })

  it('fails fast when a non-delegated operation declares delegated services', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'test.unused_service_policy',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['session'],
        delegatedServices: ['copilot'],
      } as never)
    ).toThrow('Operation test.unused_service_policy has inconsistent delegated service policy')
  })

  it('fails fast for duplicate delegated services', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'test.duplicate_service_policy',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['delegated'],
        delegatedServices: ['copilot', 'copilot'],
      } as never)
    ).toThrow('Operation test.duplicate_service_policy declares duplicate delegated services')
  })

  it('preserves, validates, and freezes its resource policy binding', () => {
    const operation = defineWorkspaceOperation({
      id: 'test.credential_use',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['executor'],
      resourcePolicy: {
        resourceType: 'credential_group',
        action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
      },
    })

    expect(operation.resourcePolicy).toEqual({
      resourceType: 'credential_group',
      action: 'credential_groups.credentials.use',
    })
    expect(Object.isFrozen(operation.resourcePolicy)).toBe(true)
  })

  it('fails fast for an action outside the operation resource type', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'test.invalid_resource_policy',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['delegated'],
        delegatedServices: ['executor'],
        resourcePolicy: {
          resourceType: 'credential_group',
          action: 'credentials.invalid',
        },
      } as never)
    ).toThrow('Action credentials.invalid does not apply to resource policy type credential_group')
  })
})
