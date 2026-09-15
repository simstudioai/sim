/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  params: vi.fn(),
  host: vi.fn(),
  workflows: vi.fn(),
  tables: vi.fn(),
  files: vi.fn(),
  knowledge: vi.fn(),
  permissions: vi.fn(),
  select: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useParams: mocks.params }))
vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/hooks/queries/workspace-host', () => ({ useWorkspaceHostContextQuery: mocks.host }))
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: mocks.workflows }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: mocks.tables }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: mocks.files }))
vi.mock('@/hooks/queries/kb/knowledge', () => ({ useKnowledgeBasesQuery: mocks.knowledge }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => null,
  WorkspaceHostProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: mocks.permissions,
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
  WorkflowScopeSync: () => null,
}))

import {
  parseSpecialTags,
  WorkspaceResourceDisplay,
  type WorkspaceResourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.params.mockReturnValue({ organizationId: 'org', workspaceId: 'stale-workspace' })
  mocks.host.mockImplementation((id: string) => ({
    data: { workspace: { id }, hostOrganizationId: 'org' },
    isPending: false,
  }))
  mocks.permissions.mockImplementation(({ children }: { children: ReactNode }) => children)
  mocks.workflows.mockReturnValue({ data: [{ id: 'workflow-id', name: 'Authorized workflow' }] })
  mocks.tables.mockReturnValue({ data: [] })
  mocks.files.mockReturnValue({ data: [] })
  mocks.knowledge.mockReturnValue({ data: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function render(data: WorkspaceResourceTagData) {
  act(() => root.render(<WorkspaceResourceDisplay data={data} onSelect={mocks.select} />))
}

describe('workspace resource tag ownership', () => {
  it('looks up and opens the explicit organization owner, never the active URL workspace', () => {
    render({ type: 'workflow', id: 'workflow-id', workspaceId: 'workspace-b' })
    expect(mocks.host).toHaveBeenCalledWith('workspace-b')
    expect(mocks.workflows).toHaveBeenCalledWith('workspace-b')
    act(() => container.querySelector('button')?.click())
    expect(mocks.select).toHaveBeenCalledWith({
      type: 'workflow',
      id: 'workflow-id',
      title: 'Authorized workflow',
      workspaceId: 'workspace-b',
    })
  })
  it('does not guess the owner of an ambiguous organization file path', () => {
    render({ type: 'file', path: 'files/report.csv' })
    expect(container.textContent).toContain('explicit workspace target')
    expect(mocks.host).not.toHaveBeenCalled()
    expect(mocks.files).not.toHaveBeenCalled()
    expect(container.querySelector('button')).toBeNull()
  })
  it.each([
    { isPending: false, error: new Error('Access revoked') },
    {
      isPending: false,
      data: { workspace: { id: 'workspace-b' }, hostOrganizationId: 'foreign-org' },
    },
    { isPending: true },
  ])('does not read resource inventories before current same-org authorization: %j', (state) => {
    mocks.host.mockReturnValue(state)
    render({ type: 'workflow', id: 'workflow-id', workspaceId: 'workspace-b' })
    expect(mocks.workflows).not.toHaveBeenCalled()
    expect(mocks.files).not.toHaveBeenCalled()
    expect(container.querySelector('button')).toBeNull()
  })
  it('retains workspace chat resource identity without adding an owner stamp', () => {
    mocks.params.mockReturnValue({ workspaceId: 'workspace-a' })
    render({ type: 'workflow', id: 'workflow-id' })
    expect(mocks.host).not.toHaveBeenCalled()
    expect(mocks.workflows).toHaveBeenCalledWith('workspace-a')
    act(() => container.querySelector('button')?.click())
    expect(mocks.select).toHaveBeenCalledWith({
      type: 'workflow',
      id: 'workflow-id',
      title: 'Authorized workflow',
    })
  })
  it('preserves explicit tag metadata while rejecting malformed owner fields', () => {
    const data = { type: 'file', path: 'files/report.csv', workspaceId: 'workspace-b' }
    expect(
      parseSpecialTags(`<workspace_resource>${JSON.stringify(data)}</workspace_resource>`).segments
    ).toEqual([{ type: 'workspace_resource', data }])
    for (const workspaceId of ['', ' ', 42, ' workspace-b']) {
      expect(
        parseSpecialTags(
          `<workspace_resource>${JSON.stringify({ ...data, workspaceId })}</workspace_resource>`
        ).segments.some((segment) => segment.type === 'workspace_resource')
      ).toBe(false)
    }
  })
})
