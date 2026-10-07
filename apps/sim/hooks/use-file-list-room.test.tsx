/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const room = vi.hoisted(() => ({ changed: undefined as (() => void) | undefined }))
vi.mock('@/hooks/use-invalidation-room', () => ({
  useInvalidationRoom: (_id: string, _type: string, changed: () => void) => {
    room.changed = changed
  },
}))

import { workspaceFileTableKeys } from '@/hooks/queries/utils/file-table-keys'
import { useFileListRoom } from '@/hooks/use-file-list-room'

function RoomProbe() {
  useFileListRoom({ entityType: 'project', entityId: 'changed-project' })
  return null
}

it('refreshes open CSV previews after a Project room change without refetching another Project', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  const currentKey = workspaceFileTableKeys.projectPreview('changed-project', 'file', 'key')
  const otherKey = workspaceFileTableKeys.projectPreview('other-project', 'file', 'key')
  const current = new QueryObserver(client, {
    queryKey: currentKey,
    queryFn: async () => 'updated',
  })
  const other = new QueryObserver(client, {
    queryKey: otherKey,
    queryFn: async () => 'changed unexpectedly',
  })
  client.setQueryData(currentKey, 'original')
  client.setQueryData(otherKey, 'other original')
  const unsubscribeCurrent = current.subscribe(() => {})
  const unsubscribeOther = other.subscribe(() => {})
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <RoomProbe />
        </QueryClientProvider>
      )
    )
    act(() => room.changed?.())
    await vi.waitFor(() => expect(client.getQueryData(currentKey)).toBe('updated'))
    expect(client.getQueryData(otherKey)).toBe('other original')
  } finally {
    act(() => root.unmount())
    container.remove()
    unsubscribeCurrent()
    unsubscribeOther()
    client.clear()
  }
})
