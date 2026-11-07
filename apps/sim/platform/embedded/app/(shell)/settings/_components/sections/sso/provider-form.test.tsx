/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SearchProps {
  value: string | null
  search: { onQueryChange: (query: string, details: { reason: string }) => void }
}

vi.mock('@sim/emcn-legacy', () => emcnMock)
vi.mock('@/ee/sso/hooks/sso', () => ({
  useConfigureSSO: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/platform/embedded/lib/data/sso/params', () => ({
  useSsoOrigin: () => 'http://localhost',
}))
vi.mock('@sim/emcn/picker/searchable-select', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/emcn/picker/searchable-select')>()),
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

import { ProviderForm } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/provider-form'

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
    stubResizeObserver()
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
