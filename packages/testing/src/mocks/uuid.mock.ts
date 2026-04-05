/**
 * UUID mock utilities for testing.
 *
 * @deprecated Prefer `vi.hoisted()` + `vi.mock('@/lib/core/utils/uuid', ...)` directly
 * in test files. These helpers use `vi.doMock` which violates project testing rules.
 */
import { vi } from 'vitest'

/**
 * @deprecated Use `vi.hoisted()` + `vi.mock('@/lib/core/utils/uuid', ...)` instead.
 */
export function mockGenerateId(mockValue = 'test-uuid') {
  vi.doMock('@/lib/core/utils/uuid', () => ({
    generateId: vi.fn().mockReturnValue(mockValue),
    generateShortId: vi.fn().mockImplementation((size = 21) => mockValue.slice(0, size)),
    isValidUuid: vi
      .fn()
      .mockImplementation((v: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
      ),
  }))
}

/** @deprecated Use `mockGenerateId` instead. */
export const mockUuid = mockGenerateId
