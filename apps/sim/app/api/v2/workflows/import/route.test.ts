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

import { v2ImportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import {
  type ImportWorkflowResult,
  importWorkflow,
} from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'
import { POST } from '@/app/api/v2/workflows/import/route'

/** With `defineV2JsonRoute` mocked to return its definition, `POST` is that definition. */
const definition = POST as unknown as {
  present: (result: ImportWorkflowResult) => { data: Record<string, unknown> }
}

const importedWorkflow = {
  id: 'workflow-1',
  name: 'Imported',
  description: null,
  workspaceId: 'ws-1',
  folderId: null,
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  blocks: [],
}

describe('/api/v2/workflows/import route definition', () => {
  it('uses authorized admission and preserves the bounded import lifecycle', () => {
    expect(POST).toMatchObject({
      operation: workflowOperations.import,
      useCase: importWorkflow,
      errorPolicy: v2WorkflowErrorPolicies.import,
      parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
    })
  })

  /**
   * The presenter dropped the imported blocks, so an import that created three
   * blocks answered with nothing a caller could check short of reading the
   * state back — and a client filling in `blocks: []` reported an empty import.
   */
  it('presents the blocks the import created', () => {
    const blocks = [
      { id: 'block-1', type: 'starter', name: 'Start' },
      { id: 'block-2', type: 'agent', name: 'Classify' },
      { id: 'block-3', type: 'response', name: 'Reply' },
    ]

    const { data } = definition.present({
      workflow: {
        id: 'workflow-1',
        name: 'Imported',
        description: null,
        workspaceId: 'ws-1',
        folderId: null,
        sortOrder: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        blocks,
      },
      folderPath: '/',
      warnings: [],
    })

    expect(data).toMatchObject({ id: 'workflow-1', name: 'Imported', folderPath: '/', blocks })
  })

  /**
   * Export clears workspace bindings, so a round-tripped workflow used to land
   * silently unable to run. The warnings are the response's way of saying which
   * fields to set, and the contract requires the array even when it is empty.
   */
  it('presents the stripped-binding warnings and the contract requires them', () => {
    const warnings = ['Lookup: tableId was stripped by export; set it before running']

    const body = definition.present({ workflow: importedWorkflow, folderPath: '/', warnings })

    expect(body.data.warnings).toEqual(warnings)
    expect(v2ImportWorkflowContract.response.schema.parse(body)).toEqual(body)
    expect(
      v2ImportWorkflowContract.response.schema.safeParse({
        data: { ...body.data, warnings: undefined },
      }).success
    ).toBe(false)
  })
})
