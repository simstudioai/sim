/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ defineRoute: vi.fn((definition) => definition) }))

vi.mock('@/lib/api/server/routes', () => ({
  createInternalResourceConcealmentPolicy: vi.fn(() => ({ kind: 'conceal-internal-resource' })),
  internalOrchestrationErrorPolicy: { kind: 'internal-plain' },
  createInternalSessionOrExecutorAuth: vi.fn(() => ({ authenticate: vi.fn() })),
  createV2ResourceConcealmentPolicy: vi.fn(() => ({ kind: 'conceal-resource' })),
  defineV2JsonRoute: mocks.defineRoute,
  v2ApiKeyAuth: { kind: 'v2-api-key' },
  v2RateLimits: { publicApi: { kind: 'public-api' } },
  v2OrchestrationErrorPolicy: { kind: 'orchestration-errors' },
}))

import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  createWorkflowFolder,
  deleteWorkflowFolder,
  listWorkflowFolders,
  relocateWorkflowFolder,
} from '@/lib/workflows/application/workflow-folders'
import { DELETE, GET, PATCH, POST } from '@/app/api/v2/workflows/folders/route'

describe('/api/v2/workflows/folders route definitions', () => {
  it('binds every method to the matching semantic operation and authorized use case', () => {
    expect(GET).toMatchObject({
      operation: workflowOperations.listFolders,
      useCase: listWorkflowFolders,
      errorPolicy: v2WorkflowErrorPolicies.default,
    })
    expect(POST).toMatchObject({
      operation: workflowOperations.createFolder,
      useCase: createWorkflowFolder,
      errorPolicy: v2WorkflowErrorPolicies.default,
    })
    expect(PATCH).toMatchObject({
      operation: workflowOperations.relocateFolder,
      useCase: relocateWorkflowFolder,
      errorPolicy: v2WorkflowErrorPolicies.default,
    })
    expect(DELETE).toMatchObject({
      operation: workflowOperations.deleteFolder,
      useCase: deleteWorkflowFolder,
      errorPolicy: v2WorkflowErrorPolicies.default,
    })
  })

  it('maps only contract-owned inputs into application inputs', () => {
    expect(
      Reflect.get(
        GET,
        'mapInput'
      )({
        query: {
          workspaceId: 'ws-1',
          parentPath: '/',
          search: 'reports',
          sortBy: 'name',
          sortOrder: 'asc',
        },
      })
    ).toEqual({
      workspaceId: 'ws-1',
      parentPath: '/',
      search: 'reports',
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(
      Reflect.get(
        DELETE,
        'mapInput'
      )({
        query: { workspaceId: 'ws-1', path: '/Reports', recursive: true },
      })
    ).toEqual({ workspaceId: 'ws-1', path: '/Reports', recursive: true })
  })
})
