import { describe, expect, it } from 'vitest'
import type { StoredTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/types'
import {
  isAgentToolBlock,
  isCustomToolAlreadySelected,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/utils'

describe('isAgentToolBlock', () => {
  it('excludes hidden blocks such as the legacy File block', () => {
    expect(isAgentToolBlock({ type: 'file', category: 'blocks', hideFromToolbar: true })).toBe(
      false
    )
  })

  it('does not admit a versioned block whose base type is unlisted', () => {
    expect(
      isAgentToolBlock({ type: 'memory_v2', category: 'blocks', hideFromToolbar: false })
    ).toBe(false)
  })
})

describe('already-selected checks', () => {
  const selectedTools: StoredTool[] = [
    { type: 'mcp', toolId: 'shared-id', title: 'MCP Tool' },
    { type: 'custom-tool', customToolId: 'custom-1' },
    {
      type: 'custom-tool',
      title: 'Legacy Tool',
      toolId: 'custom-myFunction',
      schema: { function: { name: 'myFunction' } },
      code: 'return true',
    },
    { type: 'http_request', toolId: 'mcp-only-id' },
    { type: 'workflow_input', toolId: 'workflow_executor', params: { workflowId: 'workflow-a' } },
    { type: 'workflow_input', toolId: 'workflow_executor' },
  ]

  it('matches a custom tool only by customToolId, never an MCP id or a legacy inline tool', () => {
    expect(isCustomToolAlreadySelected(selectedTools, 'custom-1')).toBe(true)
    expect(isCustomToolAlreadySelected(selectedTools, 'shared-id')).toBe(false)
    expect(isCustomToolAlreadySelected(selectedTools, 'custom-myFunction')).toBe(false)
    expect(
      isCustomToolAlreadySelected(
        [{ type: 'mcp', toolId: 'mcp-id', customToolId: 'custom-2' } as StoredTool],
        'custom-2'
      )
    ).toBe(false)
  })
})
