/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defineRoute: vi.fn((definition) => definition),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes', () => ({
  defineInternalJsonRoute: mocks.defineRoute,
  internalRateLimits: { none: vi.fn(({ reason }) => ({ kind: 'none', reason })) },
  internalSessionAuth: { kind: 'session-auth' },
}))
vi.mock('@/app/api/workspaces/[id]/sandboxes/error-policy', () => ({
  internalSandboxErrorPolicy: { kind: 'sandbox-policy' },
  internalSandboxResourceErrorPolicy: { kind: 'sandbox-resource-policy' },
}))
vi.mock('@/lib/sandboxes/application/use-cases', () => ({
  updateWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.update' }, execute: mocks.update },
  deleteWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.delete' }, execute: mocks.remove },
}))

import { DELETE, PATCH } from '@/app/api/workspaces/[id]/sandboxes/[sandboxId]/route'

const params = { id: 'workspace-1', sandboxId: 'sandbox-1' }

describe('/api/workspaces/[id]/sandboxes/[sandboxId] application adapters', () => {
  it('updates through the concealing policy with both ids taken from the path', () => {
    expect(PATCH).toMatchObject({
      contract: { method: 'PATCH', path: '/api/workspaces/[id]/sandboxes/[sandboxId]' },
      auth: { kind: 'session-auth' },
      operation: { id: 'sandboxes.update' },
      useCase: { operation: { id: 'sandboxes.update' } },
      rateLimit: { kind: 'none' },
      errorPolicy: { kind: 'sandbox-resource-policy' },
    })
    expect(
      Reflect.get(PATCH, 'mapInput')({ params, body: { dependencies: ['pandas', 'numpy'] } })
    ).toEqual({
      workspaceId: 'workspace-1',
      sandboxId: 'sandbox-1',
      dependencies: ['pandas', 'numpy'],
      source: 'settings',
    })
    expect(Reflect.get(PATCH, 'present')({ sandbox: { id: 'sandbox-1' } })).toEqual({
      sandbox: { id: 'sandbox-1' },
    })
  })

  it('deletes through the concealing policy and keeps the legacy acknowledgement', () => {
    expect(DELETE).toMatchObject({
      contract: { method: 'DELETE' },
      auth: { kind: 'session-auth' },
      operation: { id: 'sandboxes.delete' },
      useCase: { operation: { id: 'sandboxes.delete' } },
      errorPolicy: { kind: 'sandbox-resource-policy' },
    })
    expect(Reflect.get(DELETE, 'mapInput')({ params })).toEqual({
      workspaceId: 'workspace-1',
      sandboxId: 'sandbox-1',
      source: 'settings',
    })
    expect(Reflect.get(DELETE, 'present')({ sandbox: { id: 'sandbox-1' } })).toEqual({
      success: true,
    })
  })
})
