/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { EmbeddedProjectFile } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/project-file'
import { projectFilesKeys } from '@/hooks/queries/utils/project-file-keys'

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)
vi.mock('@/hooks/use-file-list-room', () => ({ useFileListRoom: () => {} }))
const viewer = vi.hoisted(() => ({ input: {} as Record<string, unknown> }))
vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer', () => ({
  FileViewer: (props: Record<string, unknown>) => {
    viewer.input = props
    return null
  },
}))

it('excludes ownerless preview fields at the Project viewer boundary', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const client = new QueryClient()
  client.setQueryData(projectFilesKeys.record('project', 'file'), {
    file: { id: 'file', owner: { entityType: 'project', entityId: 'project' } },
    capabilities: { canWrite: true },
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  const preview = { streamingContent: 'Unqualified workspace preview', isAgentEditing: true }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <EmbeddedProjectFile projectId='project' fileId='file' {...preview} />
        </QueryClientProvider>
      )
    )
    expect(viewer.input).toMatchObject({
      owner: { entityType: 'project', entityId: 'project' },
      collaborative: true,
      canEdit: true,
    })
    expect(viewer.input).not.toHaveProperty('streamingContent')
    expect(viewer.input).not.toHaveProperty('isAgentEditing')
  } finally {
    await act(async () => root.unmount())
    client.clear()
  }
})
