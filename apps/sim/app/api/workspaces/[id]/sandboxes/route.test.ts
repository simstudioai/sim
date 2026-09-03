/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defineRoute: vi.fn((definition) => definition),
  list: vi.fn(),
  create: vi.fn(),
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
  listWorkspaceSandboxesUseCase: { operation: { id: 'sandboxes.list' }, execute: mocks.list },
  createWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.create' }, execute: mocks.create },
}))

import { GET, POST } from '@/app/api/workspaces/[id]/sandboxes/route'

const sandbox = {
  id: 'sandbox-1',
  name: 'data-tools',
  language: 'python',
  dependencies: ['pandas'],
  cliTools: [],
  systemPackages: [],
  buildStatus: 'ready',
  errorCode: null,
  errorMessage: null,
  errorDetail: null,
  builtAt: '2026-08-04T12:00:00.000Z',
  createdAt: '2026-08-04T11:00:00.000Z',
  updatedAt: '2026-08-04T12:00:00.000Z',
}

describe('/api/workspaces/[id]/sandboxes application adapters', () => {
  it('binds the list to the read operation, session auth, and the shared error policy', () => {
    expect(GET).toMatchObject({
      contract: { method: 'GET', path: '/api/workspaces/[id]/sandboxes' },
      auth: { kind: 'session-auth' },
      operation: { id: 'sandboxes.list' },
      useCase: { operation: { id: 'sandboxes.list' } },
      rateLimit: { kind: 'none' },
      errorPolicy: { kind: 'sandbox-policy' },
    })
  })

  it('lists the whole set in name order and presents exactly the legacy body', () => {
    expect(Reflect.get(GET, 'mapInput')({ params: { id: 'workspace-1' } })).toEqual({
      workspaceId: 'workspace-1',
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(
      Reflect.get(
        GET,
        'present'
      )({
        sandboxes: [sandbox],
        nextCursorKeys: null,
        strategy: 'prebuilt',
        entitled: false,
        sortBy: 'name',
        sortOrder: 'asc',
      })
    ).toEqual({ sandboxes: [sandbox], strategy: 'prebuilt', entitled: false })
  })

  it('creates from the settings surface with the workspace taken from the path', () => {
    expect(POST).toMatchObject({
      contract: { method: 'POST' },
      auth: { kind: 'session-auth' },
      operation: { id: 'sandboxes.create' },
      useCase: { operation: { id: 'sandboxes.create' } },
      rateLimit: { kind: 'none' },
    })
    const body = {
      name: 'data-tools',
      language: 'python',
      dependencies: ['pandas'],
      cliTools: [],
      systemPackages: [],
    }
    expect(Reflect.get(POST, 'mapInput')({ params: { id: 'workspace-1' }, body })).toEqual({
      workspaceId: 'workspace-1',
      ...body,
      source: 'settings',
    })
    expect(Reflect.get(POST, 'present')({ sandbox })).toEqual({ sandbox })
  })
})
