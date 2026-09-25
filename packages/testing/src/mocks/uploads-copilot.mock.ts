import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/uploads/contexts/copilot`. Both are bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
 *
 * uploadsCopilotMockFns.mockUploadCopilotFile.mockResolvedValue({ key: 'copilot/file.png' })
 * ```
 */
export const uploadsCopilotMockFns = {
  mockDownloadCopilotFile: vi.fn(),
  mockUploadCopilotFile: vi.fn(),
}

/**
 * Static mock module for `@/lib/uploads/contexts/copilot`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)
 * ```
 */
export const uploadsCopilotMock = {
  downloadCopilotFile: uploadsCopilotMockFns.mockDownloadCopilotFile,
  uploadCopilotFile: uploadsCopilotMockFns.mockUploadCopilotFile,
}
