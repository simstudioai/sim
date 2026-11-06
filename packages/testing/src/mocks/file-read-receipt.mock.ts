import { vi } from 'vitest'

const fileReadReceiptMockFns = {
  mockCreateFileReadReceipt: vi.fn(() => ({
    owner: { entityType: 'workspace' as const, entityId: 'workspace-1' },
    files: [],
  })),
  mockAssertFileReadReceiptCurrent: vi.fn(async () => []),
  mockRecheckFileReadReceipt: vi.fn(async () => ({ status: 'exact' as const, entries: [] })),
}

export const fileReadReceiptMock = {
  assertFileReadReceiptCurrent: fileReadReceiptMockFns.mockAssertFileReadReceiptCurrent,
  createFileReadReceipt: fileReadReceiptMockFns.mockCreateFileReadReceipt,
  recheckFileReadReceipt: fileReadReceiptMockFns.mockRecheckFileReadReceipt,
}
