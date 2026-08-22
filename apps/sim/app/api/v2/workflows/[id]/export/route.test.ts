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
import { exportWorkflow } from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { GET } from '@/app/api/v2/workflows/[id]/export/route'

describe('/api/v2/workflows/[id]/export route definition', () => {
  it('uses canonical workflow authorization with tenant-boundary concealment', () => {
    expect(GET).toMatchObject({
      operation: workflowOperations.export,
      useCase: exportWorkflow,
      errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
    })
  })

  /**
   * Next aliases a missing `HEAD` export onto `GET`, and RFC 9110 §9.2.1 defines
   * `HEAD` as safe. This `GET` is not: the use case projects a
   * `WORKFLOW_EXPORTED` audit event, so an uptime monitor or link checker
   * probing the documented URL would file an export that never handed anyone
   * the workflow.
   */
  it('does not run the audited export for a HEAD probe', () => {
    expect(GET).toMatchObject({ headSafe: false })
  })

  /**
   * Not running the export is only half of it. The `HEAD` must still resolve the
   * workflow and check access, or the probe answers 200 for an id the caller's
   * `GET` would conceal as a 404 — an existence oracle over every workspace's
   * workflow ids. The builder refuses at definition time to pair
   * `headSafe: false` with a use case that cannot answer that on its own.
   */
  it('exposes an authorization phase the HEAD probe can run without exporting', () => {
    expect(typeof exportWorkflow.authorize).toBe('function')
  })
})
