/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  requireWorkspaceId: vi.fn(() => 'workspace-canonical'),
  readTable: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
  requireExecutorWorkspaceId: mocks.requireWorkspaceId,
}))

vi.mock('@/lib/table/application/tables', () => ({
  readTableDefinitionUseCase: { execute: mocks.readTable },
}))

import { readTableSchemaAsExecutor } from '@/lib/internal/table/read-schema'

const PRINCIPAL = createTestRuntimePrincipal()

describe('readTableSchemaAsExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.readTable.mockResolvedValue({
      table: {
        name: 'Customers',
        schema: {
          columns: [
            { id: 'column-email', name: 'email', type: 'string' },
            { id: 'column-score', name: 'score', type: 'number' },
          ],
        },
      },
    })
  })

  it('binds the read to the canonical delegated workspace', async () => {
    const result = await readTableSchemaAsExecutor({
      tableId: 'table-1',
      context: {
        workflowId: 'workflow-1',
        principal: PRINCIPAL,
      },
    })

    expect(mocks.readTable).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { tableId: 'table-1', workspaceId: 'workspace-canonical' },
    })
    expect(result).toEqual({
      name: 'Customers',
      columns: [
        { name: 'email', type: 'string' },
        { name: 'score', type: 'number' },
      ],
    })
  })

  /**
   * A select column's cardinality decides which filter operators it accepts, so
   * LLM enrichment needs it to name the right subset. It is carried only for
   * select columns, where it means something.
   */
  it('carries select cardinality through and omits it elsewhere', async () => {
    mocks.readTable.mockResolvedValue({
      table: {
        name: 'Transactions',
        schema: {
          columns: [
            { id: 'column-category', name: 'category', type: 'select' },
            { id: 'column-tags', name: 'tags', type: 'select', multiple: true },
            { id: 'column-amount', name: 'amount', type: 'number' },
          ],
        },
      },
    })

    const result = await readTableSchemaAsExecutor({
      tableId: 'table-1',
      context: {
        workflowId: 'workflow-1',
        principal: PRINCIPAL,
      },
    })

    expect(result.columns).toEqual([
      { name: 'category', type: 'select', multiple: false },
      { name: 'tags', type: 'select', multiple: true },
      { name: 'amount', type: 'number' },
    ])
  })

  it('fails closed when canonical schema metadata is malformed', async () => {
    mocks.readTable.mockResolvedValueOnce({
      table: { name: 'Customers', schema: { columns: [{ name: 'email', type: 'unknown' }] } },
    })

    await expect(
      readTableSchemaAsExecutor({
        tableId: 'table-1',
        context: {
          workflowId: 'workflow-1',
          principal: PRINCIPAL,
        },
      })
    ).rejects.toThrow('Invalid table column 0 while enriching schema for table-1')
  })
})
