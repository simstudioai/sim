import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/application/tables`. Every function is a bare
 * `vi.fn()`. Each use case is exposed as its `execute` knob (`mock<UseCase>`) and its
 * `authorize` knob (`mock<UseCase>Authorize`).
 *
 * @example
 * ```ts
 * import { tableApplicationTablesMockFns } from '@sim/testing/mocks/table-application-tables.mock'
 *
 * tableApplicationTablesMockFns.mockReadTableDefinitionUseCase.mockResolvedValue({ table })
 * ```
 */
export const tableApplicationTablesMockFns = {
  mockListTablesUseCase: vi.fn(),
  mockListTablesUseCaseAuthorize: vi.fn(),
  mockListTableDefinitionsUseCase: vi.fn(),
  mockListTableDefinitionsUseCaseAuthorize: vi.fn(),
  mockCreateTableUseCase: vi.fn(),
  mockCreateTableUseCaseAuthorize: vi.fn(),
  mockReadTableUseCase: vi.fn(),
  mockReadTableUseCaseAuthorize: vi.fn(),
  mockReadTableDefinitionUseCase: vi.fn(),
  mockReadTableDefinitionUseCaseAuthorize: vi.fn(),
  mockReadTableDetailsUseCase: vi.fn(),
  mockReadTableDetailsUseCaseAuthorize: vi.fn(),
  mockUpdateTableUseCase: vi.fn(),
  mockUpdateTableUseCaseAuthorize: vi.fn(),
  mockDeleteTableUseCase: vi.fn(),
  mockDeleteTableUseCaseAuthorize: vi.fn(),
  mockRestoreTableUseCase: vi.fn(),
  mockRestoreTableUseCaseAuthorize: vi.fn(),
}

const fns = tableApplicationTablesMockFns

/**
 * Static mock module for `@/lib/table/application/tables`. Each use case is
 * `{ operation: { id }, authorize, execute }` with the real operation id.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)
 * ```
 */
export const tableApplicationTablesMock = {
  listTablesUseCase: {
    operation: { id: 'tables.list' },
    authorize: fns.mockListTablesUseCaseAuthorize,
    execute: fns.mockListTablesUseCase,
  },
  listTableDefinitionsUseCase: {
    operation: { id: 'tables.list' },
    authorize: fns.mockListTableDefinitionsUseCaseAuthorize,
    execute: fns.mockListTableDefinitionsUseCase,
  },
  createTableUseCase: {
    operation: { id: 'tables.create' },
    authorize: fns.mockCreateTableUseCaseAuthorize,
    execute: fns.mockCreateTableUseCase,
  },
  readTableUseCase: {
    operation: { id: 'tables.read' },
    authorize: fns.mockReadTableUseCaseAuthorize,
    execute: fns.mockReadTableUseCase,
  },
  readTableDefinitionUseCase: {
    operation: { id: 'tables.read' },
    authorize: fns.mockReadTableDefinitionUseCaseAuthorize,
    execute: fns.mockReadTableDefinitionUseCase,
  },
  readTableDetailsUseCase: {
    operation: { id: 'tables.read' },
    authorize: fns.mockReadTableDetailsUseCaseAuthorize,
    execute: fns.mockReadTableDetailsUseCase,
  },
  updateTableUseCase: {
    operation: { id: 'tables.update' },
    authorize: fns.mockUpdateTableUseCaseAuthorize,
    execute: fns.mockUpdateTableUseCase,
  },
  deleteTableUseCase: {
    operation: { id: 'tables.delete' },
    authorize: fns.mockDeleteTableUseCaseAuthorize,
    execute: fns.mockDeleteTableUseCase,
  },
  restoreTableUseCase: {
    operation: { id: 'tables.restore' },
    authorize: fns.mockRestoreTableUseCaseAuthorize,
    execute: fns.mockRestoreTableUseCase,
  },
}
