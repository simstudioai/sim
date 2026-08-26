/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  v2AgentToolInputSchema,
  v2ApplyWorkflowOperationsBodySchema,
} from '@/lib/api/contracts/v2/workflows'

describe('v2AgentToolInputSchema', () => {
  it('accepts catalog integration, custom-tool reference, and MCP tool shapes', () => {
    const tools = [
      {
        type: 'cloudwatch',
        operation: 'describe_alarm_history',
        usageControl: 'auto',
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
    [{ type: 'slack', operation: 'send', usageControl: 'sometimes' }],
  ])('rejects a malformed reserved tool shape', (tools) => {
    expect(v2AgentToolInputSchema.safeParse(tools).success).toBe(false)
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
