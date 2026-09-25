import { vi } from 'vitest'

function toClassNames(input: unknown): string[] {
  if (!input) return []
  if (typeof input === 'string' || typeof input === 'number') return [String(input)]
  if (Array.isArray(input)) return input.flatMap(toClassNames)
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => name)
  }
  return []
}

let toastIdCounter = 0

/** Returns a fresh id per toast, like the real `toast()` and its variants. */
function nextToastId(..._args: unknown[]): string {
  toastIdCounter += 1
  return `mock-toast-${toastIdCounter}`
}

const mockToast = Object.assign(vi.fn(nextToastId), {
  success: vi.fn(nextToastId),
  error: vi.fn(nextToastId),
  warning: vi.fn(nextToastId),
  info: vi.fn(nextToastId),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
})

/**
 * Controllable mock functions for the non-component surface of `@sim/emcn`.
 *
 * - `mockToast` is the imperative `toast`: a callable `vi.fn()` carrying `success`/`error`/
 *   `warning`/`info`/`dismiss`/`dismissAll` `vi.fn()`s (no provider needed). `toast()` and each
 *   variant return a fresh string id (`mock-toast-1`, …) like the real API; `dismiss` and
 *   `dismissAll` are bare.
 * - `mockUseToast` returns `{ toast: mockToast, dismiss: mockToast.dismiss, dismissAll: mockToast.dismissAll }`.
 * - `mockCn` joins truthy class values clsx-style (strings, arrays, `{ class: bool }` objects)
 *   WITHOUT tailwind-merge, so conflicting utilities are both kept.
 *
 * @example
 * ```ts
 * import { emcnMockFns } from '@sim/testing/mocks/emcn.mock'
 *
 * expect(emcnMockFns.mockToast.error).toHaveBeenCalledWith('Upload failed')
 * ```
 */
export const emcnMockFns = {
  mockToast,
  mockUseToast: vi.fn(() => ({
    toast: mockToast,
    dismiss: mockToast.dismiss,
    dismissAll: mockToast.dismissAll,
  })),
  mockCn: vi.fn((...inputs: unknown[]): string => inputs.flatMap(toClassNames).join(' ')),
}

/**
 * Mock module for `@sim/emcn` covering ONLY its non-component surface: `toast`, `useToast`,
 * `ToastProvider` (renders `children`) and `cn`. Components are deliberately absent — the local
 * component shims differ per test (what each renders and which props it forwards), so a test that
 * renders emcn components spreads this object and adds its own shims.
 *
 * @example
 * ```ts
 * vi.mock('@sim/emcn', () => emcnMock)
 * vi.mock('@sim/emcn', () => ({ ...emcnMock, Button: ({ children }) => <button>{children}</button> }))
 * ```
 */
export const emcnMock = {
  toast: emcnMockFns.mockToast,
  useToast: emcnMockFns.mockUseToast,
  ToastProvider: ({ children }: { children?: unknown }): unknown => children ?? null,
  cn: emcnMockFns.mockCn,
}
