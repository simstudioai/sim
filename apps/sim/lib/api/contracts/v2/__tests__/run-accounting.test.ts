/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { logsOpenApiDocument } from '@/lib/api/contracts/v2/openapi/logs'
import { workflowsOpenApiDocument } from '@/lib/api/contracts/v2/openapi/workflows'
import { v2WorkflowListItemSchema } from '@/lib/api/contracts/v2/workflows'
import type { OpenApiDocumentDefinition } from '@/lib/api/openapi/types'

/**
 * The two documented facts about run accounting that a caller cannot discover
 * from a response, and that a wrong description therefore turns into a silent
 * wrong answer.
 *
 * `runCount` is a monotonic column on the workflow row, incremented for every
 * settled outcome (paused runs count once they settle), and never decremented
 * by log retention. `GET /workflows/{workflowId}/runs` reads the execution-log table,
 * which lists every recorded run *and* is hard-deleted on the workspace's
 * retention window. The counter can therefore exceed the retained list, and each
 * operation has to say so where a caller reads it.
 */
function operationDescription(document: OpenApiDocumentDefinition, operationId: string): string {
  const route = document.routes.find((entry) => entry.operation.operationId === operationId)
  if (!route) throw new Error(`No documented operation ${operationId}`)
  return route.operation.description
}

function fieldDescription(field: string): string {
  const shape = v2WorkflowListItemSchema.shape as Record<string, { description?: string }>
  return shape[field]?.description ?? ''
}

describe('v2 run accounting descriptions', () => {
  it('discloses that runCount includes every settled outcome and defers paused runs', () => {
    const description = fieldDescription('runCount')

    expect(description).toMatch(/settled runs/i)
    expect(description).toMatch(/completed, failed, or cancelled/i)
    expect(description).toMatch(/paused run is counted once it settles/i)
  })

  it('discloses that runCount is not the length of the runs list', () => {
    expect(fieldDescription('runCount')).toMatch(/retention/i)
  })

  it('discloses that lastRunAt tracks the same settled-run population', () => {
    expect(fieldDescription('lastRunAt')).toMatch(/latest settled run, whatever its outcome/i)
  })

  it.each([
    ['workflows', () => operationDescription(workflowsOpenApiDocument, 'listWorkflowRunsV2')],
    ['logs', () => operationDescription(logsOpenApiDocument, 'listLogs')],
  ])('documents the run retention window on the %s list', (_name, read) => {
    const description = read()

    expect(description).toMatch(/retention/i)
    expect(description).toMatch(/30 days/i)
  })
})
