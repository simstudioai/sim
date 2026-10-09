/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileCopyModal } from '@/app/workspace/[workspaceId]/files/components/file-copy-modal'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { workspaceKeys } from '@/hooks/queries/workspace'

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)

let client: QueryClient
let root: Root
let container: HTMLDivElement
const requests: string[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  requests.length = 0
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(workspaceKeys.list(), { workspaces: [] })
  vi.stubGlobal('fetch', async (input: string) => {
    requests.push(input)
    return Response.json(
      input.startsWith('/api/projects')
        ? {
            projects: [
              {
                id: 'project',
                name: 'Cached Project',
                organizationId: null,
                ownerId: 'user',
                archivedAt: null,
                createdAt: '2026-10-08T00:00:00Z',
                updatedAt: '2026-10-08T00:00:00Z',
                environments: [],
                capabilities: { administer: true, issues: true },
              },
            ],
            nextCursor: 'next-page',
          }
        : { workspaces: [] }
    )
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.useRealTimers()
})
async function render(projects: boolean, projectFiles: boolean) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <FeatureFlagsProvider
          flags={{
            projects,
            'project-files': projectFiles,
            dashboards: false,
            'mothership-model-selector': false,
            'mothership-plan-mode': false,
          }}
        >
          <FileCopyModal
            source={{
              owner: { entityType: 'workspace', entityId: 'workspace' },
              fileIds: ['file'],
              folderIds: [],
            }}
            onClose={() => {}}
          />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  )
}

it.each([
  [false, true],
  [true, false],
  [false, false],
])('stops Project destination reads after flags become %s/%s', async (projects, projectFiles) => {
  await render(true, true)
  await act(async () => vi.advanceTimersByTimeAsync(10))
  expect(requests.some((url) => url.startsWith('/api/projects'))).toBe(true)
  requests.length = 0
  await render(projects, projectFiles)
  await act(async () => client.invalidateQueries())
  expect(requests.filter((url) => url.startsWith('/api/projects'))).toEqual([])
})
