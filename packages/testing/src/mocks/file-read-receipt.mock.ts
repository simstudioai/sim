import { vi } from 'vitest'

const fileReadReceiptMockFns = {
  mockCreateFileReadReceipt: vi.fn(() => ({
    owner: { entityType: 'workspace' as const, entityId: 'workspace-1' },
    files: [],
  })),
  mockRecheckFileReadReceipt: vi.fn(async () => ({ status: 'exact' as const, entries: [] })),
}

export const fileReadReceiptMock = {
  createFileReadReceipt: fileReadReceiptMockFns.mockCreateFileReadReceipt,
  recheckFileReadReceipt: fileReadReceiptMockFns.mockRecheckFileReadReceipt,
}
