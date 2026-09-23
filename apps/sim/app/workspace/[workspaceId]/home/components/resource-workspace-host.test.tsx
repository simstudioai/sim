/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  host: vi.fn(),
  inherited: vi.fn(),
  permissions: vi.fn(),
  provider: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/provider-models-loader', () => ({
  ProviderModelsLoader: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/custom-blocks-loader', () => ({
  CustomBlocksLoader: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/block-visibility-loader', () => ({
  BlockVisibilityLoader: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/settings-loader', () => ({
  SettingsLoader: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-scope-sync', () => ({
  WorkflowScopeSync: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/hooks/queries/workspace-host', () => ({ useWorkspaceHostContextQuery: mocks.host }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: mocks.inherited,
  WorkspaceHostProvider: mocks.provider,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: mocks.permissions,
}))

import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.inherited.mockReturnValue(null)
  mocks.provider.mockImplementation(({ children }: { children: ReactNode }) => children)
  mocks.permissions.mockImplementation(({ children }: { children: ReactNode }) => children)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(workspaceId = 'ws-a') {
  await act(async () =>
    root.render(
      <ResourceWorkspaceHost workspaceId={workspaceId} organizationId='org-a' workflowId='flow-a'>
        <p>Private resource</p>
      </ResourceWorkspaceHost>
    )
  )
}
describe('organization resource workspace host', () => {
  it.each([{ isPending: true }, { isPending: false, error: new Error('Forbidden') }])(
    'keeps inline loading and denied states valid inside Markdown paragraphs: %j',
    async (state) => {
      mocks.host.mockReturnValue(state)
      await act(async () =>
        root.render(
          <p>
            <ResourceWorkspaceHost workspaceId='ws-a' organizationId='org-a' inline>
              <span>Private resource</span>
            </ResourceWorkspaceHost>
          </p>
        )
      )
      expect(container.querySelector('p > span[role="status"]')).not.toBeNull()
      expect(container.querySelector('p div')).toBeNull()
      expect(container.textContent).not.toContain('Private resource')
    }
  )

  it.each([
    { isPending: true },
    { isPending: false, error: new Error('Forbidden') },
    { isPending: false, data: { workspace: { id: 'ws-a' }, hostOrganizationId: 'other-org' } },
  ])('does not mount resource content before same-org authorization: %j', async (state) => {
    mocks.host.mockReturnValue(state)
    await render()
    expect(container.textContent).not.toContain('Private resource')
    expect(mocks.permissions).not.toHaveBeenCalled()
  })
  it('uses the selected resource workspace and updates permissions when switching owners', async () => {
    mocks.host.mockImplementation((id: string) => ({
      isPending: false,
      data: { workspace: { id }, hostOrganizationId: 'org-a' },
    }))
    await render()
    expect(container.textContent).toContain('Private resource')
    expect(mocks.permissions).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-a', workflowId: 'flow-a' }),
      undefined
    )
    await render('ws-b')
    expect(mocks.host).toHaveBeenLastCalledWith('ws-b')
    expect(mocks.permissions).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-b' }),
      undefined
    )
  })
  it('reuses an existing exact workspace host without another permission provider', async () => {
    mocks.inherited.mockReturnValue({ workspace: { id: 'ws-a' }, hostOrganizationId: 'org-a' })
    await render()
    expect(container.textContent).toContain('Private resource')
    expect(mocks.host).not.toHaveBeenCalled()
    expect(mocks.permissions).not.toHaveBeenCalled()
  })
})
