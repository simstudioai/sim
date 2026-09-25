import { vi } from 'vitest'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let idCounter = 0
let shortIdCounter = 0

/** A valid v4-shaped UUID ending in the sequence number: `00000000-0000-4000-8000-000000000001`. */
function nextSequentialUuid(): string {
  idCounter += 1
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, '0')}`
}

/**
 * Controllable mock functions for `@sim/utils/id`.
 *
 * Defaults are deterministic: `generateId()` yields sequential valid UUIDs
 * (`00000000-0000-4000-8000-000000000001`, `…002`, …), `generateShortId()` yields
 * `short-id-1`, `short-id-2`, …, and `isValidUuid` is the real regex check. Most tests pin a
 * fixed id instead: `idMockFns.mockGenerateId.mockReturnValue('run-1')`.
 *
 * @example
 * ```ts
 * import { idMockFns } from '@sim/testing/mocks/id.mock'
 *
 * idMockFns.mockGenerateId.mockReturnValueOnce('execution-1')
 * ```
 */
export const idMockFns = {
  mockGenerateId: vi.fn((): string => nextSequentialUuid()),
  mockGenerateShortId: vi.fn((_size?: number, _alphabet?: string): string => {
    shortIdCounter += 1
    return `short-id-${shortIdCounter}`
  }),
  mockIsValidUuid: vi.fn((value: string): boolean => UUID_RE.test(value)),
}

/**
 * Static mock module for `@sim/utils/id`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/utils/id', () => idMock)
 * ```
 */
export const idMock = {
  generateId: idMockFns.mockGenerateId,
  generateShortId: idMockFns.mockGenerateShortId,
  isValidUuid: idMockFns.mockIsValidUuid,
}

/**
 * Restarts both sequences and restores the default implementations. Call it in `beforeEach` when
 * a test asserts on the sequential defaults.
 */
export function resetIdMock(): void {
  idCounter = 0
  shortIdCounter = 0
  idMockFns.mockGenerateId.mockReset()
  idMockFns.mockGenerateShortId.mockReset()
  idMockFns.mockIsValidUuid.mockReset()
}
