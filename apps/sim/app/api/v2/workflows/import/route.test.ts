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
import { importWorkflow } from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'
import { POST } from '@/app/api/v2/workflows/import/route'

describe('/api/v2/workflows/import route definition', () => {
  it('uses authorized admission and preserves the bounded import lifecycle', () => {
    expect(POST).toMatchObject({
      operation: workflowOperations.import,
      useCase: importWorkflow,
      errorPolicy: v2WorkflowErrorPolicies.import,
      parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
    })
  })
})
