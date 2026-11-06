/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SearchProps {
  value: string | null
  search: { onQueryChange: (query: string, details: { reason: string }) => void }
}

vi.mock('@sim/emcn', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/platform/lib/data/sso', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/lib/data/sso')>()),
  useConfigureSSO: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSsoOrigin: () => 'http://localhost',
}))
vi.mock('@/platform/design-system/components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/design-system/components')>()),
  SearchableSelect: ({ value, search }: SearchProps): ReactNode => (
    <div>
      <output>{value ?? 'empty'}</output>
      <button
        type='button'
        onClick={() => search.onQueryChange('typed', { reason: 'input-change' })}
      >
        type
      </button>
      <button type='button' onClick={() => search.onQueryChange('', { reason: 'input-clear' })}>
        close popup
      </button>
      <button type='button' onClick={() => search.onQueryChange('', { reason: 'input-change' })}>
        erase
      </button>
    </div>
  ),
}))

import { ProviderForm } from '@/platform/app/(shell)/settings/_components/sections/sso/provider-form'

describe('ProviderForm provider ID', () => {
  let container: HTMLDivElement
  let root: Root

  const click = (name: string) =>
    act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((node) => node.textContent === name)
        ?.click()
    })

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<ProviderForm organizationId='org-1' onOpenDomains={vi.fn()} onSaved={vi.fn()} />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps a typed ID when the popup closes and clears its own query', async () => {
    await click('type')
    await click('close popup')
    expect(container.querySelector('output')?.textContent).toBe('typed')
  })

  it('still clears when the viewer erases what they typed', async () => {
    await click('type')
    await click('erase')
    expect(container.querySelector('output')?.textContent).toBe('empty')
  })
})
