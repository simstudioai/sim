/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/browser-agent/transport', () => ({ isBrowserAgentAvailable: () => false }))
vi.mock('@/lib/terminal/transport', () => ({ isTerminalAvailable: () => false }))
vi.mock('@/blocks/integration-matcher', () => ({ listIntegrationsByPopularity: () => [] }))
vi.mock('@/hooks/queries/custom-tools', () => ({
  useCustomTools: () => ({
    data: [{ id: 'tool-1', title: 'Lookup order' }],
    isPending: false,
  }),
}))
vi.mock('@/hooks/queries/folders', () => ({
  useFolders: () => ({ data: [], isPending: false }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => ({ data: [], isPending: false }),
}))
vi.mock('@/hooks/queries/logs', () => ({
  useLogsList: () => ({ data: { pages: [] }, isPending: false }),
}))
vi.mock('@/hooks/queries/mcp', () => ({
  useMcpServers: () => ({
    data: [{ id: 'server-1', name: 'DeepWiki' }],
    isPending: false,
  }),
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMothershipChats: () => ({ data: [], isPending: false }),
}))
vi.mock('@/hooks/queries/skills', () => ({
  useSkills: () => ({
    data: [{ id: 'skill-1', name: 'Research' }],
    isPending: false,
  }),
}))
vi.mock('@/hooks/queries/tables', () => ({
  useTablesList: () => ({ data: [], isPending: false }),
}))
vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflows: () => ({ data: [], isPending: false }),
}))
vi.mock('@/hooks/queries/workspace-file-folders', () => ({
  useWorkspaceFileFolders: () => ({ data: [], isPending: false }),
}))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFiles: () => ({ data: [], isPending: false }),
}))

import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/add-resource-dropdown'

describe('useAvailableResources panel resource groups', () => {
  it('offers Skills, Custom Tools, and MCP servers to the panel picker', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let latest: ReturnType<typeof useAvailableResources> | undefined

    function Probe() {
      latest = useAvailableResources('workspace-1', { enabled: true })
      return null
    }

    act(() => root.render(<Probe />))

    expect(latest?.groups.find(({ type }) => type === 'skill')).toEqual({
      type: 'skill',
      items: [{ id: 'skill-1', name: 'Research' }],
    })
    expect(latest?.groups.find(({ type }) => type === 'custom_tool')).toEqual({
      type: 'custom_tool',
      items: [{ id: 'tool-1', name: 'Lookup order' }],
    })
    expect(latest?.groups.find(({ type }) => type === 'mcp_server')).toEqual({
      type: 'mcp_server',
      items: [{ id: 'server-1', name: 'DeepWiki' }],
    })
    expect(latest?.isHydrating).toBe(false)

    act(() => root.unmount())
    container.remove()
  })
})
