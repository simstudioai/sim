/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ defineRoute: vi.fn((definition) => definition) }))

vi.mock('@/lib/api/server/routes', () => ({
  createInternalSessionOrExecutorAuth: vi.fn(() => ({ authenticate: vi.fn() })),
  defineV2JsonRoute: mocks.defineRoute,
  v2ApiKeyAuth: { kind: 'v2-api-key' },
  v2RateLimits: { publicApi: { kind: 'public-api' } },
  v2OrchestrationErrorPolicy: { kind: 'orchestration-errors' },
}))

import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { exportWorkflow } from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { GET } from '@/app/api/v2/workflows/[id]/export/route'

describe('/api/v2/workflows/[id]/export route definition', () => {
  it('uses canonical workflow authorization', () => {
    expect(GET).toMatchObject({
      operation: workflowOperations.export,
      useCase: exportWorkflow,
      errorPolicy: v2WorkflowErrorPolicies.default,
    })
  })
})
