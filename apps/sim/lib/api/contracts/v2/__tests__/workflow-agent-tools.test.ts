/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_ID_LENGTH } from '@/lib/api/contracts/primitives'
import {
  MAX_AGENT_TOOLS_PER_BLOCK,
  v2AgentToolInputSchema,
  v2ApplyWorkflowOperationsBodySchema,
} from '@/lib/api/contracts/v2/workflows'
import { MAX_MCP_TOOL_NAME_BYTES } from '@/lib/mcp/constants'

describe('v2AgentToolInputSchema', () => {
  it('accepts catalog integration, custom-tool reference, and both MCP tool shapes', () => {
    const tools = [
      {
        type: 'cloudwatch',
        operation: 'describe_alarm_history',
        usageControl: 'auto',
        usageControlExpression: '<route.toolMode>',
        params: { region: 'us-east-1' },
      },
      {
        type: 'custom-tool',
        customToolId: 'cst_123',
        usageControl: 'force',
      },
      {
        type: 'mcp',
        params: { serverId: 'mcp_123', toolName: 'search_docs', collection: 'incidents' },
        usageControl: 'none',
      },
      {
        type: 'mcp-server-advanced',
        params: { serverId: 'mcp_456' },
        usageControl: 'auto',
      },
    ]

    expect(v2AgentToolInputSchema.parse(tools)).toEqual(tools)
  })

  it('keeps the legacy inline custom-tool shape available for workflow round trips', () => {
    const tools = [
      {
        type: 'custom-tool',
        schema: {
          type: 'function',
          function: {
            name: 'lookup_incident',
            description: 'Look up an incident.',
            parameters: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
        code: 'return params.id',
      },
    ]

    expect(v2AgentToolInputSchema.parse(tools)).toEqual(tools)
  })

  it.each([
    [{ type: 'custom-tool', usageControl: 'auto' }],
    [{ type: 'mcp', params: { serverId: 'mcp_123' }, usageControl: 'auto' }],
    [{ type: 'mcp-server-advanced', params: {}, usageControl: 'auto' }],
    [{ type: 'mcp-server-advanced', params: { serverId: 'mcp_123', toolName: 'lookup' } }],
    [{ type: 'slack', operation: 'send', usageControl: 'sometimes' }],
  ])('rejects a malformed reserved tool shape', (tools) => {
    expect(v2AgentToolInputSchema.safeParse(tools).success).toBe(false)
  })

  it('rejects a tool list above the workflow-operation ceiling', () => {
    const tools = Array.from({ length: MAX_AGENT_TOOLS_PER_BLOCK + 1 }, (_, index) => ({
      type: `integration-${index}`,
    }))

    expect(v2AgentToolInputSchema.safeParse(tools).success).toBe(false)
  })

  it.each([
    [
      'inline function name',
      {
        type: 'custom-tool',
        schema: {
          type: 'function',
          function: { name: 'a'.repeat(65), parameters: { type: 'object' } },
        },
        code: 'return null',
      },
    ],
    [
      'MCP server id',
      {
        type: 'mcp',
        params: { serverId: 'a'.repeat(MAX_ID_LENGTH + 1), toolName: 'search_docs' },
      },
    ],
    [
      'MCP tool name',
      {
        type: 'mcp',
        params: {
          serverId: 'mcp_123',
          toolName: 'a'.repeat(MAX_MCP_TOOL_NAME_BYTES + 1),
        },
      },
    ],
    [
      'advanced MCP server id',
      {
        type: 'mcp-server-advanced',
        params: { serverId: 'a'.repeat(MAX_ID_LENGTH + 1) },
      },
    ],
    [
      'MCP multibyte tool name',
      {
        type: 'mcp',
        params: {
          serverId: 'mcp_123',
          toolName: '💡'.repeat(Math.floor(MAX_MCP_TOOL_NAME_BYTES / 4) + 1),
        },
      },
    ],
  ])('rejects an overlong %s', (_label, tool) => {
    expect(v2AgentToolInputSchema.safeParse([tool]).success).toBe(false)
  })
})

describe('workflow operation Agent tools contract', () => {
  it('publishes and validates tools under params.inputs without closing other catalog inputs', () => {
    const body = {
      operations: [
        {
          operation_type: 'add',
          block_id: 'triage',
          params: {
            type: 'agent',
            name: 'Triage',
            inputs: {
              model: 'gpt-5',
              tools: [
                {
                  type: 'cloudwatch',
                  operation: 'describe_alarms',
                  params: { region: 'us-west-2' },
                  usageControl: 'auto',
                  futureMetadata: { preserved: true },
                },
              ],
            },
            futureOperationSetting: true,
          },
        },
      ],
    }

    expect(v2ApplyWorkflowOperationsBodySchema.parse(body)).toEqual({
      ...body,
      atomic: false,
      layout: 'targeted',
    })
  })

  it('rejects malformed Agent tools before the edit engine runs', () => {
    const parsed = v2ApplyWorkflowOperationsBodySchema.safeParse({
      operations: [
        {
          operation_type: 'add',
          block_id: 'triage',
          params: {
            type: 'agent',
            name: 'Triage',
            inputs: { tools: [{ type: 'mcp', params: { serverId: 'mcp_123' } }] },
          },
        },
      ],
    })

    expect(parsed.success).toBe(false)
  })
})
