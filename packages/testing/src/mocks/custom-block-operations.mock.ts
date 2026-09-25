import { vi } from 'vitest'

/**
 * Mirrors `CustomBlockValidationError` from `@/lib/workflows/custom-blocks/operations`: same
 * `name` and single `message` constructor argument. The real class extends plain `Error`, so
 * `instanceof` against the mocked export behaves like production.
 */
export class MockCustomBlockValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomBlockValidationError'
  }
}

/**
 * Controllable mock functions for `@/lib/workflows/custom-blocks/operations`.
 *
 * Every function is a bare `vi.fn()` (resolves/returns `undefined`) except
 * `mockGetCustomBlockRowsForWorkspace`, which resolves `[]` (no custom blocks in the workspace).
 *
 * @example
 * ```ts
 * import { customBlockOperationsMockFns } from '@sim/testing/mocks/custom-block-operations.mock'
 *
 * customBlockOperationsMockFns.mockListCustomBlocksWithInputsForWorkspace.mockResolvedValue([])
 * ```
 */
export const customBlockOperationsMockFns = {
  mockIsCustomBlocksDeploymentEnabled: vi.fn(),
  mockIsCustomBlocksEligibleForOrganization: vi.fn(),
  mockIsCustomBlocksEligible: vi.fn(),
  mockGetCustomBlockRowsForOrg: vi.fn(),
  mockGetCustomBlockRowsForWorkspace: vi.fn(
    async (_workspaceId: string, ..._rest: unknown[]): Promise<unknown[]> => []
  ),
  mockListCustomBlocksWithInputsForWorkspace: vi.fn(),
  mockListCustomBlockSummariesForWorkspace: vi.fn(),
  mockListCustomBlocksWithInputs: vi.fn(),
  mockGetCustomBlockWithInputsByWorkflowId: vi.fn(),
  mockGetCustomBlockManageContext: vi.fn(),
  mockGetCustomBlockAuthority: vi.fn(),
  mockResolveCustomBlockToolBinding: vi.fn(),
  mockPublishCustomBlock: vi.fn(),
  mockUpdateCustomBlock: vi.fn(),
  mockDeleteCustomBlock: vi.fn(),
  mockGetCustomBlockUsageCounts: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/custom-blocks/operations`. Covers every runtime export;
 * `CustomBlockValidationError` is {@link MockCustomBlockValidationError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)
 * ```
 */
export const customBlockOperationsMock = {
  isCustomBlocksDeploymentEnabled: customBlockOperationsMockFns.mockIsCustomBlocksDeploymentEnabled,
  isCustomBlocksEligibleForOrganization:
    customBlockOperationsMockFns.mockIsCustomBlocksEligibleForOrganization,
  isCustomBlocksEligible: customBlockOperationsMockFns.mockIsCustomBlocksEligible,
  getCustomBlockRowsForOrg: customBlockOperationsMockFns.mockGetCustomBlockRowsForOrg,
  getCustomBlockRowsForWorkspace: customBlockOperationsMockFns.mockGetCustomBlockRowsForWorkspace,
  listCustomBlocksWithInputsForWorkspace:
    customBlockOperationsMockFns.mockListCustomBlocksWithInputsForWorkspace,
  listCustomBlockSummariesForWorkspace:
    customBlockOperationsMockFns.mockListCustomBlockSummariesForWorkspace,
  listCustomBlocksWithInputs: customBlockOperationsMockFns.mockListCustomBlocksWithInputs,
  getCustomBlockWithInputsByWorkflowId:
    customBlockOperationsMockFns.mockGetCustomBlockWithInputsByWorkflowId,
  getCustomBlockManageContext: customBlockOperationsMockFns.mockGetCustomBlockManageContext,
  getCustomBlockAuthority: customBlockOperationsMockFns.mockGetCustomBlockAuthority,
  resolveCustomBlockToolBinding: customBlockOperationsMockFns.mockResolveCustomBlockToolBinding,
  CustomBlockValidationError: MockCustomBlockValidationError,
  publishCustomBlock: customBlockOperationsMockFns.mockPublishCustomBlock,
  updateCustomBlock: customBlockOperationsMockFns.mockUpdateCustomBlock,
  deleteCustomBlock: customBlockOperationsMockFns.mockDeleteCustomBlock,
  getCustomBlockUsageCounts: customBlockOperationsMockFns.mockGetCustomBlockUsageCounts,
}
