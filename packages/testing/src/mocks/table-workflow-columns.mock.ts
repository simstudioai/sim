import { vi } from 'vitest'

interface MockCellRun {
  executionId: string
  workflowId: string
  tableId: string
  rowId: string
  groupId: string
}

interface MockStoredRow {
  id: string
  data: unknown
  position: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Controllable mock functions for `@/lib/table/workflow-columns` (which also re-exports
 * `getUnmetGroupDeps` / `optimisticallyScheduleNewlyEligibleGroups` from `@/lib/table/deps`).
 *
 * Defaults (real pure logic): `buildWorkflowGroupExecutionCorrelation`, `cellCancelKey`,
 * `cellTagsFor`, `toTableRow`. `runWorkflowColumn` and `cancelCellRunsByTags` resolve `undefined`.
 * Every other function (eligibility, scheduling, enqueue building, cancel, stash/find) is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableWorkflowColumnsMockFns } from '@sim/testing/mocks/table-workflow-columns.mock'
 *
 * tableWorkflowColumnsMockFns.mockPickNextEligibleGroupForRow.mockReturnValue(null)
 * ```
 */
export const tableWorkflowColumnsMockFns = {
  mockGetUnmetGroupDeps: vi.fn(),
  mockOptimisticallyScheduleNewlyEligibleGroups: vi.fn(),
  mockClassifyEligibility: vi.fn(),
  mockIsGroupEligible: vi.fn(),
  mockPickNextEligibleGroupForRow: vi.fn(),
  mockBuildPendingRuns: vi.fn(),
  mockBuildEnqueueItems: vi.fn(),
  mockBuildWorkflowGroupExecutionCorrelation: vi.fn((run: MockCellRun) => ({
    executionId: run.executionId,
    requestId: `wfgrp-${run.executionId}`,
    source: 'workflow_group',
    workflowId: run.workflowId,
    triggerType: 'table',
    tableId: run.tableId,
    rowId: run.rowId,
    groupId: run.groupId,
  })),
  mockCellCancelKey: vi.fn(
    (tableId: string, rowId: string, groupId: string): string => `${tableId}:${rowId}:${groupId}`
  ),
  mockCellTagsFor: vi.fn((run: Pick<MockCellRun, 'tableId' | 'rowId' | 'groupId'>): string[] => [
    `tableId:${run.tableId}`,
    `rowId:${run.rowId}`,
    `group:${run.groupId}`,
  ]),
  mockCancelCellRunsByTags: vi.fn(async (_tags: string[]): Promise<void> => {}),
  mockToTableRow: vi.fn((row: MockStoredRow, executions: Record<string, unknown> = {}) => ({
    id: row.id,
    data: row.data,
    executions,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })),
  mockCancelWorkflowGroupRuns: vi.fn(),
  mockAssertWorkflowGroupsDeployable: vi.fn(),
  mockRunWorkflowColumn: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockStashCellContextForResume: vi.fn(),
  mockFindCellContextByExecutionId: vi.fn(),
}

/**
 * Static mock module for `@/lib/table/workflow-columns`. `TABLE_CONCURRENCY_LIMIT` carries the
 * real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
 * ```
 */
export const tableWorkflowColumnsMock = {
  TABLE_CONCURRENCY_LIMIT: 20,
  getUnmetGroupDeps: tableWorkflowColumnsMockFns.mockGetUnmetGroupDeps,
  optimisticallyScheduleNewlyEligibleGroups:
    tableWorkflowColumnsMockFns.mockOptimisticallyScheduleNewlyEligibleGroups,
  classifyEligibility: tableWorkflowColumnsMockFns.mockClassifyEligibility,
  isGroupEligible: tableWorkflowColumnsMockFns.mockIsGroupEligible,
  pickNextEligibleGroupForRow: tableWorkflowColumnsMockFns.mockPickNextEligibleGroupForRow,
  buildPendingRuns: tableWorkflowColumnsMockFns.mockBuildPendingRuns,
  buildEnqueueItems: tableWorkflowColumnsMockFns.mockBuildEnqueueItems,
  buildWorkflowGroupExecutionCorrelation:
    tableWorkflowColumnsMockFns.mockBuildWorkflowGroupExecutionCorrelation,
  cellCancelKey: tableWorkflowColumnsMockFns.mockCellCancelKey,
  cellTagsFor: tableWorkflowColumnsMockFns.mockCellTagsFor,
  cancelCellRunsByTags: tableWorkflowColumnsMockFns.mockCancelCellRunsByTags,
  toTableRow: tableWorkflowColumnsMockFns.mockToTableRow,
  cancelWorkflowGroupRuns: tableWorkflowColumnsMockFns.mockCancelWorkflowGroupRuns,
  assertWorkflowGroupsDeployable: tableWorkflowColumnsMockFns.mockAssertWorkflowGroupsDeployable,
  runWorkflowColumn: tableWorkflowColumnsMockFns.mockRunWorkflowColumn,
  stashCellContextForResume: tableWorkflowColumnsMockFns.mockStashCellContextForResume,
  findCellContextByExecutionId: tableWorkflowColumnsMockFns.mockFindCellContextByExecutionId,
}
