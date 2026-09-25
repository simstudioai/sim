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
import type { ImportWorkflowResult } from '@/lib/workflows/application/import-export'
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

  it('omits an unknown block summary when presenting a legacy receipt replay', async () => {
    const { blocks: _blocks, ...workflow } = importedWorkflow
    const body = definition.present({ workflow, replayed: true, folderPath: '/', warnings: [] })
    const serialized = await Response.json(body).json()
    expect(serialized.data).not.toHaveProperty('blocks')
    expect(v2ImportWorkflowContract.response.schema.parse(serialized)).toEqual(serialized)
  })
})
