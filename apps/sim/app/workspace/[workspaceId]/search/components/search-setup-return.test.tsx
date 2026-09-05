/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/settings/credential-groups',
  useRouter: () => ({ push }),
}))

import { SearchSetupReturn } from '@/app/workspace/[workspaceId]/search/components/search-setup-return'

let root: Root | undefined
let container: HTMLDivElement

async function render(node: ReactNode, searchParams: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams}>
        {node}
      </NuqsTestingAdapter>
    )
  )
}

beforeEach(() => {
  push.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  vi.unstubAllGlobals()
})

describe('returning to Search setup', () => {
  it.each([
    ['slack', '/workspace/workspace-1/search?addConnector=slack'],
    ['search', '/workspace/workspace-1/search'],
  ])('returns to the original %s setup', async (source, href) => {
    await render(<SearchSetupReturn workspaceId='workspace-1' />, `?search-setup=${source}`)
    await act(async () => container.querySelector('button')?.click())
    expect(push).toHaveBeenCalledWith(href)
  })

  it('lets the existing unsaved-settings guard defer navigation', async () => {
    const guard = vi.fn()
    await render(
      <SearchSetupReturn workspaceId='workspace-1' onNavigate={guard} />,
      '?search-setup=slack'
    )
    await act(async () => container.querySelector('button')?.click())
    expect(push).not.toHaveBeenCalled()
    expect(guard).toHaveBeenCalledOnce()
    guard.mock.calls[0][0]()
    expect(push).toHaveBeenCalledWith('/workspace/workspace-1/search?addConnector=slack')
  })

  it('ignores unrecognized destinations', async () => {
    await render(
      <SearchSetupReturn workspaceId='workspace-1' />,
      '?search-setup=https://unrelated.example'
    )
    expect(container.querySelector('button')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })
})
