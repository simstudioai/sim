import { vi } from 'vitest'

/** Controllable compound billing boundaries for workspace and account lifecycle tests. */
export const billingPayerTransferMockFns = {
  mockChangeOrganizationWorkspaceBilledAccountsInTx: vi.fn(),
  mockChangeWorkspaceStoragePayerInTx: vi.fn(),
  mockChangeProjectAndWorkspaceStoragePayersInTx: vi.fn(),
}

export const billingPayerTransferMock = {
  changeOrganizationWorkspaceBilledAccountsInTx:
    billingPayerTransferMockFns.mockChangeOrganizationWorkspaceBilledAccountsInTx,
  changeWorkspaceStoragePayerInTx: billingPayerTransferMockFns.mockChangeWorkspaceStoragePayerInTx,
  changeProjectAndWorkspaceStoragePayersInTx:
    billingPayerTransferMockFns.mockChangeProjectAndWorkspaceStoragePayersInTx,
}
