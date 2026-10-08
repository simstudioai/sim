/** @vitest-environment jsdom */

import { act } from 'react'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { MothershipResourcesProvider } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { MothershipView } from '@/app/workspace/[workspaceId]/home/components/mothership-view/mothership-view'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { getProjectFileQueryOptions } from '@/hooks/queries/project-files'

vi.mock('@/lib/auth/auth-client', () => authClientMock)

vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-view/components', () => ({
  ResourceTabs: () => null,
  ResourceActions: () => null,
  ResourceContent: () => <div data-testid='private-file' />,
}))
vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer', () => ({
  isCsvStreamOnly: () => false,
  isMarkdownFile: () => false,
  isPreviewable: () => false,
  RICH_PREVIEWABLE_EXTENSIONS: new Set(),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session',
  () => ({ BrowserSession: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-session',
  () => ({ TerminalSession: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/generic-resource-content',
  () => ({ GenericResourceContent: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/search-resource-content',
  () => ({ SearchResourceContent: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/sources-resource-content',
  () => ({ SourcesResourceContent: () => null })
)

const mounted: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount()
  })
  document.body.innerHTML = ''
})

it.each([
  [false, true],
  [true, false],
  [false, false],
  [true, true],
])(
  'only activates a persisted Project tab when projects=%s and project-files=%s are both enabled',
  async (projects, projectFiles) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const resource = {
      type: 'file' as const,
      id: 'file',
      title: 'notes.txt',
      owner: { entityType: 'project' as const, entityId: 'project' },
    }
    const options = getProjectFileQueryOptions('project', 'file')
    client.setQueryData(options.queryKey, {
      file: { id: 'file', name: 'notes.txt', type: 'text/plain' },
      capabilities: { canRead: true, canWrite: false },
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push(root)
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <FeatureFlagsProvider
            flags={{
              projects,
              'project-files': projectFiles,
              dashboards: false,
              'table-row-ttl': false,
              'mothership-model-selector': false,
              'mothership-plan-mode': false,
            }}
          >
            <MothershipResourcesProvider
              selectResource={vi.fn()}
              addResource={vi.fn()}
              removeResource={vi.fn()}
              reorderResources={vi.fn()}
              collapseResource={vi.fn()}
            >
              <MothershipView
                resources={[resource]}
                activeResourceId={getChatResourceSelectionId(resource)}
                desktopScopeId='chat'
                isCollapsed={false}
                onSummarize={vi.fn()}
              />
            </MothershipResourcesProvider>
          </FeatureFlagsProvider>
        </QueryClientProvider>
      )
    )
    expect(client.getQueryCache().find({ queryKey: options.queryKey })?.isActive()).toBe(
      projects && projectFiles
    )
    expect(container.querySelector('[data-testid=private-file]') !== null).toBe(
      projects && projectFiles
    )
    client.clear()
  }
)
