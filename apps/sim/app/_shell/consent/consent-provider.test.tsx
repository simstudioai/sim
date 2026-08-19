/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockPathname, mockDynamicImport } = vi.hoisted(() => ({
  mockPathname: vi.fn(),
  mockDynamicImport: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: mockPathname }))

/**
 * Stands in for the lazily-loaded runtime and records whether the chunk was
 * asked for at all — that, not just the absence of a banner, is what the
 * workspace gate is for.
 */
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    return function LazyRuntime() {
      mockDynamicImport(loader)
      return <span data-testid='runtime' />
    }
  },
}))

import { ConsentProvider } from '@/app/_shell/consent/consent-provider'

let root: Root | null = null

function renderAt(pathname: string): HTMLDivElement {
  mockPathname.mockReturnValue(pathname)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConsentProvider />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentProvider', () => {
  it.each(['/', '/pricing', '/login', '/cookie-policy', '/upgrade', '/workspaces'])(
    'mounts the consent runtime on %s',
    (pathname) => {
      const container = renderAt(pathname)

      expect(container.querySelector('[data-testid="runtime"]')).not.toBeNull()
      expect(mockDynamicImport).toHaveBeenCalled()
    }
  )

  it.each(['/workspace', '/workspace/abc', '/workspace/abc/logs'])(
    'mounts nothing on %s',
    (pathname) => {
      const container = renderAt(pathname)

      expect(container.querySelector('[data-testid="runtime"]')).toBeNull()
      expect(mockDynamicImport).not.toHaveBeenCalled()
    }
  )
})
