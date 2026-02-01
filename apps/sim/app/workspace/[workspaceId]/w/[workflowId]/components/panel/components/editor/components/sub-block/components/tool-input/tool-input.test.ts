/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

interface StoredTool {
  type: string
  title?: string
  toolId?: string
  params?: Record<string, string>
  customToolId?: string
  schema?: any
  code?: string
  operation?: string
  usageControl?: 'auto' | 'force' | 'none'
}

const isMcpToolAlreadySelected = (selectedTools: StoredTool[], mcpToolId: string): boolean => {
  return selectedTools.some((tool) => tool.type === 'mcp' && tool.toolId === mcpToolId)
}

const isCustomToolAlreadySelected = (
  selectedTools: StoredTool[],
  customToolId: string
): boolean => {
  return selectedTools.some(
    (tool) => tool.type === 'custom-tool' && tool.customToolId === customToolId
  )
}

const isWorkflowAlreadySelected = (selectedTools: StoredTool[], workflowId: string): boolean => {
  return selectedTools.some(
    (tool) => tool.type === 'workflow_input' && tool.params?.workflowId === workflowId
  )
}

describe('isMcpToolAlreadySelected', () => {
  describe('basic functionality', () => {
    it.concurrent('returns false when selectedTools is empty', () => {
      expect(isMcpToolAlreadySelected([], 'mcp-tool-123')).toBe(false)
    })

    it.concurrent('returns false when MCP tool is not in selectedTools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'different-mcp-tool', title: 'Different Tool' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-123')).toBe(false)
    })

    it.concurrent('returns true when MCP tool is already selected', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-tool-123', title: 'My MCP Tool' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-123')).toBe(true)
    })

    it.concurrent('returns true when MCP tool is one of many selected tools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', customToolId: 'custom-1' },
        { type: 'mcp', toolId: 'mcp-tool-123', title: 'My MCP Tool' },
        { type: 'workflow_input', toolId: 'workflow_executor' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-123')).toBe(true)
    })
  })

  describe('type discrimination', () => {
    it.concurrent('does not match non-MCP tools with same toolId', () => {
      const selectedTools: StoredTool[] = [{ type: 'http_request', toolId: 'mcp-tool-123' }]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-123')).toBe(false)
    })

    it.concurrent('does not match custom tools even with toolId set', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', toolId: 'custom-mcp-tool-123', customToolId: 'db-id' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-123')).toBe(false)
    })
  })

  describe('multiple MCP tools', () => {
    it.concurrent('correctly identifies first of multiple MCP tools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-tool-1', title: 'Tool 1' },
        { type: 'mcp', toolId: 'mcp-tool-2', title: 'Tool 2' },
        { type: 'mcp', toolId: 'mcp-tool-3', title: 'Tool 3' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-1')).toBe(true)
    })

    it.concurrent('correctly identifies middle MCP tool', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-tool-1', title: 'Tool 1' },
        { type: 'mcp', toolId: 'mcp-tool-2', title: 'Tool 2' },
        { type: 'mcp', toolId: 'mcp-tool-3', title: 'Tool 3' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-2')).toBe(true)
    })

    it.concurrent('correctly identifies last MCP tool', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-tool-1', title: 'Tool 1' },
        { type: 'mcp', toolId: 'mcp-tool-2', title: 'Tool 2' },
        { type: 'mcp', toolId: 'mcp-tool-3', title: 'Tool 3' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-3')).toBe(true)
    })

    it.concurrent('returns false for non-existent MCP tool among many', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-tool-1', title: 'Tool 1' },
        { type: 'mcp', toolId: 'mcp-tool-2', title: 'Tool 2' },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'mcp-tool-999')).toBe(false)
    })
  })
})

describe('isCustomToolAlreadySelected', () => {
  describe('basic functionality', () => {
    it.concurrent('returns false when selectedTools is empty', () => {
      expect(isCustomToolAlreadySelected([], 'custom-tool-123')).toBe(false)
    })

    it.concurrent('returns false when custom tool is not in selectedTools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', customToolId: 'different-custom-tool' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(false)
    })

    it.concurrent('returns true when custom tool is already selected', () => {
      const selectedTools: StoredTool[] = [{ type: 'custom-tool', customToolId: 'custom-tool-123' }]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(true)
    })

    it.concurrent('returns true when custom tool is one of many selected tools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-1', title: 'MCP Tool' },
        { type: 'custom-tool', customToolId: 'custom-tool-123' },
        { type: 'http_request', toolId: 'http_request_tool' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(true)
    })
  })

  describe('type discrimination', () => {
    it.concurrent('does not match non-custom tools with similar IDs', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'custom-tool-123', title: 'MCP with similar ID' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(false)
    })

    it.concurrent('does not match MCP tools even if customToolId happens to match', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-id', customToolId: 'custom-tool-123' } as StoredTool,
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(false)
    })
  })

  describe('legacy inline custom tools', () => {
    it.concurrent('does not match legacy inline tools without customToolId', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'custom-tool',
          title: 'Legacy Tool',
          toolId: 'custom-myFunction',
          schema: { function: { name: 'myFunction' } },
          code: 'return true',
        },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(false)
    })

    it.concurrent('does not false-positive on legacy tools when checking for database tool', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'custom-tool',
          title: 'Legacy Tool',
          schema: { function: { name: 'sameName' } },
          code: 'return true',
        },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'db-tool-1')).toBe(false)
    })
  })

  describe('multiple custom tools', () => {
    it.concurrent('correctly identifies first of multiple custom tools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', customToolId: 'custom-1' },
        { type: 'custom-tool', customToolId: 'custom-2' },
        { type: 'custom-tool', customToolId: 'custom-3' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-1')).toBe(true)
    })

    it.concurrent('correctly identifies middle custom tool', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', customToolId: 'custom-1' },
        { type: 'custom-tool', customToolId: 'custom-2' },
        { type: 'custom-tool', customToolId: 'custom-3' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-2')).toBe(true)
    })

    it.concurrent('correctly identifies last custom tool', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', customToolId: 'custom-1' },
        { type: 'custom-tool', customToolId: 'custom-2' },
        { type: 'custom-tool', customToolId: 'custom-3' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-3')).toBe(true)
    })

    it.concurrent('returns false for non-existent custom tool among many', () => {
      const selectedTools: StoredTool[] = [
        { type: 'custom-tool', customToolId: 'custom-1' },
        { type: 'custom-tool', customToolId: 'custom-2' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-999')).toBe(false)
    })
  })

  describe('mixed tool types', () => {
    it.concurrent('correctly identifies custom tool in mixed list', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-tool-1', title: 'MCP Tool' },
        { type: 'custom-tool', customToolId: 'custom-tool-123' },
        { type: 'http_request', toolId: 'http_request' },
        { type: 'workflow_input', toolId: 'workflow_executor' },
        { type: 'custom-tool', title: 'Legacy', schema: {}, code: '' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-tool-123')).toBe(true)
    })

    it.concurrent('does not confuse MCP toolId with custom customToolId', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'shared-id-123', title: 'MCP Tool' },
        { type: 'custom-tool', customToolId: 'different-id' },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'shared-id-123')).toBe(false)
    })
  })
})

describe('isWorkflowAlreadySelected', () => {
  describe('basic functionality', () => {
    it.concurrent('returns false when selectedTools is empty', () => {
      expect(isWorkflowAlreadySelected([], 'workflow-123')).toBe(false)
    })

    it.concurrent('returns false when workflow is not in selectedTools', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'different-workflow' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-123')).toBe(false)
    })

    it.concurrent('returns true when workflow is already selected', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-123' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-123')).toBe(true)
    })

    it.concurrent('returns true when workflow is one of many selected tools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'mcp-1', title: 'MCP Tool' },
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-123' },
        },
        { type: 'custom-tool', customToolId: 'custom-1' },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-123')).toBe(true)
    })
  })

  describe('type discrimination', () => {
    it.concurrent('does not match non-workflow_input tools', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'workflow-123', params: { workflowId: 'workflow-123' } },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-123')).toBe(false)
    })

    it.concurrent('does not match workflow_input without params', () => {
      const selectedTools: StoredTool[] = [{ type: 'workflow_input', toolId: 'workflow_executor' }]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-123')).toBe(false)
    })

    it.concurrent('does not match workflow_input with different workflowId in params', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'other-workflow' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-123')).toBe(false)
    })
  })

  describe('multiple workflows', () => {
    it.concurrent('allows different workflows to be selected', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-a' },
        },
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-b' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-a')).toBe(true)
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-b')).toBe(true)
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-c')).toBe(false)
    })

    it.concurrent('correctly identifies specific workflow among many', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-1' },
        },
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-2' },
        },
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-3' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-2')).toBe(true)
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-999')).toBe(false)
    })
  })
})

describe('duplicate prevention integration scenarios', () => {
  describe('add then try to re-add', () => {
    it.concurrent('prevents re-adding the same MCP tool', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'mcp',
          toolId: 'planetscale-query',
          title: 'PlanetScale Query',
          params: { serverId: 'server-1' },
        },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'planetscale-query')).toBe(true)
    })

    it.concurrent('prevents re-adding the same custom tool', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'custom-tool',
          customToolId: 'my-custom-tool-uuid',
          usageControl: 'auto',
        },
      ]
      expect(isCustomToolAlreadySelected(selectedTools, 'my-custom-tool-uuid')).toBe(true)
    })

    it.concurrent('prevents re-adding the same workflow', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'my-workflow-uuid' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'my-workflow-uuid')).toBe(true)
    })
  })

  describe('remove then re-add', () => {
    it.concurrent('allows re-adding MCP tool after removal', () => {
      const selectedToolsAfterRemoval: StoredTool[] = []
      expect(isMcpToolAlreadySelected(selectedToolsAfterRemoval, 'planetscale-query')).toBe(false)
    })

    it.concurrent('allows re-adding custom tool after removal', () => {
      const selectedToolsAfterRemoval: StoredTool[] = [
        { type: 'mcp', toolId: 'some-other-tool', title: 'Other' },
      ]
      expect(isCustomToolAlreadySelected(selectedToolsAfterRemoval, 'my-custom-tool-uuid')).toBe(
        false
      )
    })

    it.concurrent('allows re-adding workflow after removal', () => {
      const selectedToolsAfterRemoval: StoredTool[] = [
        { type: 'mcp', toolId: 'some-tool', title: 'Other' },
      ]
      expect(isWorkflowAlreadySelected(selectedToolsAfterRemoval, 'my-workflow-uuid')).toBe(false)
    })
  })

  describe('different tools with similar names', () => {
    it.concurrent('allows adding different MCP tools from same server', () => {
      const selectedTools: StoredTool[] = [
        { type: 'mcp', toolId: 'server1-tool-a', title: 'Tool A', params: { serverId: 'server1' } },
      ]
      expect(isMcpToolAlreadySelected(selectedTools, 'server1-tool-b')).toBe(false)
    })

    it.concurrent('allows adding different custom tools', () => {
      const selectedTools: StoredTool[] = [{ type: 'custom-tool', customToolId: 'custom-a' }]
      expect(isCustomToolAlreadySelected(selectedTools, 'custom-b')).toBe(false)
    })

    it.concurrent('allows adding different workflows', () => {
      const selectedTools: StoredTool[] = [
        {
          type: 'workflow_input',
          toolId: 'workflow_executor',
          params: { workflowId: 'workflow-a' },
        },
      ]
      expect(isWorkflowAlreadySelected(selectedTools, 'workflow-b')).toBe(false)
    })
  })
})
