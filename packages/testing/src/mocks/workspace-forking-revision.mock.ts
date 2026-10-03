import { vi } from 'vitest'

export const workspaceForkingRevisionMockFns = {
  mockLoadForkPreviewRevision: vi.fn(async () => ({ fingerprint: 'reviewed', categories: {} })),
  mockLockForkRevision: vi.fn(async () => {}),
  mockAssertForkPreviewFresh: vi.fn(async () => {}),
  mockAssertForkSourceVersions: vi.fn(async () => {}),
}

export const workspaceForkingRevisionMock = {
  loadForkPreviewRevision: workspaceForkingRevisionMockFns.mockLoadForkPreviewRevision,
  lockForkRevision: workspaceForkingRevisionMockFns.mockLockForkRevision,
  assertForkPreviewFresh: workspaceForkingRevisionMockFns.mockAssertForkPreviewFresh,
  assertForkSourceVersions: workspaceForkingRevisionMockFns.mockAssertForkSourceVersions,
}
