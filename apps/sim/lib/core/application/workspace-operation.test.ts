/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

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
})
