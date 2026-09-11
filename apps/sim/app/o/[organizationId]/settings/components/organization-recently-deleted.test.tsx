/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { ToastProvider } from '@sim/emcn'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsHeaderSearch } from '@/components/settings/settings-header'

const mocks = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/o/org-1/settings/recently-deleted',
}))
vi.mock('@/components/settings/settings-panel', () => ({
  SettingsPanel: ({ children, search }: { children: ReactNode; search: SettingsHeaderSearch }) => (
    <>
      <input
        aria-label={search.placeholder}
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
      />
      {children}
    </>
  ),
}))

import { OrganizationRecentlyDeleted } from '@/app/o/[organizationId]/settings/components/organization-recently-deleted'
import { type MothershipChatMetadata, mothershipChatKeys } from '@/hooks/queries/mothership-chats'

const CHATS: MothershipChatMetadata[] = [
  {
    id: 'chat-1',
    name: 'Older chat',
    updatedAt: new Date('2026-09-10'),
    deletedAt: new Date('2026-09-10'),
    isActive: false,
    isUnread: false,
    isPinned: false,
  },
  {
    id: 'chat-2',
    name: 'Recent chat',
    updatedAt: new Date('2026-09-11'),
    deletedAt: new Date('2026-09-11'),
    isActive: false,
    isUnread: false,
    isPinned: false,
  },
]
const ARCHIVED_KEY = mothershipChatKeys.organizationList('org-1', 'archived')
let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockReset().mockResolvedValue({ success: true })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ARCHIVED_KEY, CHATS)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  queryClient.clear()
  vi.unstubAllGlobals()
})

async function render(search = '') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter hasMemory searchParams={search}>
          <ToastProvider>
            <OrganizationRecentlyDeleted organizationId='org-1' />
          </ToastProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  })
}

function button(label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === label
  )!
}

describe('OrganizationRecentlyDeleted', () => {
  it('shows only this organization’s archived chats, newest deletion first', async () => {
    queryClient.setQueryData(mothershipChatKeys.list('workspace-1', 'archived'), [
      { ...CHATS[0], name: 'Workspace chat' },
    ])
    await render()
    const text = container.textContent ?? ''
    expect(text.indexOf('Recent chat')).toBeLessThan(text.indexOf('Older chat'))
    expect(text).not.toContain('Workspace chat')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('fetches the organization’s archived list when it is not cached', async () => {
    queryClient.removeQueries({ queryKey: ARCHIVED_KEY })
    mocks.request.mockResolvedValueOnce({ data: [] })
    await render()
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET' }),
      expect.objectContaining({
        query: { organizationId: 'org-1', scope: 'archived' },
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('filters through the shared settings search parameter', async () => {
    await render('?search=recent')
    expect(container.textContent).toContain('Recent chat')
    expect(container.textContent).not.toContain('Older chat')
  })

  it('restores through the shared mutation and follows the authoritative archived list', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    await render()
    await act(async () => button('Restore').click())
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }), {
      params: { chatId: 'chat-2' },
    })
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: mothershipChatKeys.organizationLists('org-1'),
    })
    await act(async () => {
      queryClient.setQueryData(ARCHIVED_KEY, [CHATS[0]])
      await sleep(1)
    })
    expect(container.textContent).not.toContain('Recent chat')
    await act(async () => {
      queryClient.setQueryData(ARCHIVED_KEY, CHATS)
      await sleep(1)
    })
    expect(container.textContent).toContain('Recent chat')
    expect(button('Restore').disabled).toBe(false)
    expect(container.textContent).not.toContain('Restored')
  })

  it('disables repeat restoration while pending and leaves failures retryable', async () => {
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const pending = Promise.withResolvers<{ success: boolean }>()
    mocks.request.mockReturnValueOnce(pending.promise)
    await render()
    await act(async () => button('Restore').click())
    await act(async () => sleep(1))
    expect(button('Restoring...').disabled).toBe(true)
    await act(async () => button('Restoring...').click())
    expect(mocks.request).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('Restore failed'))
      await sleep(1)
    })
    expect(button('Restore').disabled).toBe(false)
    expect(button('View')).toBeUndefined()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(ARCHIVED_KEY)).toEqual(CHATS)
  })
})
