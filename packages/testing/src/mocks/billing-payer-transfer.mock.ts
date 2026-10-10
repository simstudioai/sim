import { vi } from 'vitest'

/** Controllable compound billing boundaries for workspace and account lifecycle tests. */
export const billingPayerTransferMockFns = {
  mockChangeOrganizationWorkspaceBilledAccountsInTx: vi.fn(),
  mockChangeWorkspaceStoragePayerInTx: vi.fn(),
  mockChangeWorkspaceStoragePayersInTx: vi.fn(),
  mockChangeProjectAndWorkspaceStoragePayersInTx: vi.fn(),
}

export const billingPayerTransferMock = {
  changeOrganizationWorkspaceBilledAccountsInTx:
    billingPayerTransferMockFns.mockChangeOrganizationWorkspaceBilledAccountsInTx,
  changeWorkspaceStoragePayerInTx: billingPayerTransferMockFns.mockChangeWorkspaceStoragePayerInTx,
  changeWorkspaceStoragePayersInTx:
    billingPayerTransferMockFns.mockChangeWorkspaceStoragePayersInTx,
  changeProjectAndWorkspaceStoragePayersInTx:
    billingPayerTransferMockFns.mockChangeProjectAndWorkspaceStoragePayersInTx,
}
