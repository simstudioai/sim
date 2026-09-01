/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  readTable: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/table/application/tables', () => ({
  readTableDefinitionUseCase: { execute: mocks.readTable },
}))

import { readTableSchemaAsExecutor } from '@/lib/internal/table/read-schema'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  resourceScope: { tableId: 'table-1' },
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

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
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
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
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
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
          executorDelegationOrigin: {
            subjectUserId: 'user-1',
            workflowId: 'workflow-1',
          },
        },
      })
    ).rejects.toThrow('Invalid table column 0 while enriching schema for table-1')
  })
})
