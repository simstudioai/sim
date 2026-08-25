/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { MothershipResourceType } from '@/lib/copilot/resources/types'
import { mcpKeys } from '@/hooks/queries/mcp'
import { skillsKeys } from '@/hooks/queries/skills'
import { customToolsKeys } from '@/hooks/queries/utils/custom-tool-keys'
import {
  invalidateResourceQueries,
  RESOURCE_MENU_ORDER,
  RESOURCE_REGISTRY,
} from './resource-registry'

describe('resource registry coverage', () => {
  it('registers and orders every resource type exactly once', () => {
    const types = Object.values(MothershipResourceType).sort()
    expect(Object.keys(RESOURCE_REGISTRY).sort()).toEqual(types)
    expect([...RESOURCE_MENU_ORDER].sort()).toEqual(types)
  })
})

describe('panel resource invalidation', () => {
  it('refreshes the Skill and Custom Tool lists', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateResourceQueries(queryClient, 'workspace-1', 'skill', 'skill-1')
    invalidateResourceQueries(queryClient, 'workspace-1', 'custom_tool', 'tool-1')

    expect(invalidate).toHaveBeenCalledWith({ queryKey: skillsKeys.list('workspace-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customToolsKeys.list('workspace-1') })
  })

  it('refreshes the MCP server, its child tools, and stored workflow references', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateResourceQueries(queryClient, 'workspace-1', 'mcp_server', 'server-1')

    expect(invalidate).toHaveBeenCalledWith({ queryKey: mcpKeys.serversList('workspace-1') })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: mcpKeys.serverToolsList('workspace-1', 'server-1'),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mcpKeys.storedToolsList('workspace-1') })
  })
})
