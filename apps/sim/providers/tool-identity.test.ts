/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import type { AgentStreamEvent } from '@/providers/stream-events'
import {
  assignProviderToolIdentities,
  projectProviderResponseToolIdentities,
  projectStreamingExecutionToolIdentities,
} from '@/providers/tool-identity'
import type { ProviderResponse, ProviderToolConfig } from '@/providers/types'

function providerTool(id: string, credential: string): ProviderToolConfig {
  return {
    id,
    description: id,
    params: { oauthCredential: credential },
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

async function readEvents(stream: ReadableStream): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return events
    events.push(value as AgentStreamEvent)
  }
}

describe('provider tool identities', () => {
  it('keeps unique and first-occurrence ids unchanged while aliasing later instances', () => {
    const first = providerTool('gmail_send', 'credential-a')
    const second = providerTool('gmail_send', 'credential-b')
    const unique = providerTool('slack_send_message', 'credential-c')

    const identities = assignProviderToolIdentities([first, second, unique])

    expect(first.id).toBe('gmail_send')
    expect(first).not.toHaveProperty('canonicalId')
    expect(second.id).toBe('gmail_send__sim_2')
    expect(second.canonicalId).toBe('gmail_send')
    expect(second.params.oauthCredential).toBe('credential-b')
    expect(unique.id).toBe('slack_send_message')
    expect(identities.toolIdByWireId.get(second.id)).toBe('gmail_send')
    expect(second.id).not.toContain('credential-b')
  })

  it('deduplicates the same configured instance without collapsing separate instances', () => {
    const repeated = providerTool('gmail_send', 'credential-a')
    const separate = providerTool('gmail_send', 'credential-a')
    const tools = [repeated, repeated, separate]

    assignProviderToolIdentities(tools)

    expect(tools).toHaveLength(2)
    expect(tools[0]).toBe(repeated)
    expect(tools[1]).toBe(separate)
    expect(tools.map((tool) => tool.id)).toEqual(['gmail_send', 'gmail_send__sim_2'])
  })

  it('avoids canonical id collisions and produces stable aliases when applied again', () => {
    const tools = [
      providerTool('gmail_send', 'a'),
      providerTool('gmail_send__sim_2', 'reserved'),
      providerTool('gmail_send', 'b'),
    ]

    assignProviderToolIdentities(tools)
    const firstPass = tools.map((tool) => tool.id)
    assignProviderToolIdentities(tools)

    expect(new Set(firstPass).size).toBe(3)
    expect(tools.map((tool) => tool.id)).toEqual(firstPass)
    expect(firstPass[2]).toBe('gmail_send__sim_2_2')
  })

  it('bounds generated aliases to the strictest provider name limit', () => {
    const longId = `tool_${'a'.repeat(80)}`
    const tools = [providerTool(longId, 'a'), providerTool(longId, 'b')]

    assignProviderToolIdentities(tools)

    expect(tools[0].id).toBe(longId)
    expect(tools[1].id).toHaveLength(64)
    expect(tools[1].id).toMatch(/__sim_2$/)
  })

  it('projects provider response names back to their canonical ids', () => {
    const tools = [providerTool('gmail_send', 'a'), providerTool('gmail_send', 'b')]
    const identities = assignProviderToolIdentities(tools)
    const alias = tools[1].id
    const response: ProviderResponse = {
      content: 'done',
      model: 'test-model',
      toolCalls: [{ name: alias, arguments: {} }],
      timing: {
        startTime: 'start',
        endTime: 'end',
        duration: 1,
        timeSegments: [
          {
            type: 'tool',
            name: alias,
            startTime: 0,
            endTime: 1,
            duration: 1,
            toolCalls: [{ id: 'call-1', name: alias, arguments: {} }],
          },
        ],
      },
    }

    projectProviderResponseToolIdentities(response, identities)

    expect(response.toolCalls?.[0].name).toBe('gmail_send')
    expect(response.timing?.timeSegments?.[0].name).toBe('gmail_send')
    expect(response.timing?.timeSegments?.[0].toolCalls?.[0].name).toBe('gmail_send')
  })

  it('projects live events and settled streaming output without changing call ids', async () => {
    const tools = [providerTool('gmail_send', 'a'), providerTool('gmail_send', 'b')]
    const identities = assignProviderToolIdentities(tools)
    const alias = tools[1].id
    const output: NormalizedBlockOutput = {
      toolCalls: { list: [], count: 0 },
      providerTiming: {
        startTime: 'start',
        endTime: 'end',
        duration: 1,
        timeSegments: [],
      },
    }
    let settleStream: (() => void) | undefined
    const canSettle = new Promise<void>((resolve) => {
      settleStream = resolve
    })
    const response: StreamingExecution = {
      streamFormat: 'agent-events-v1',
      stream: new ReadableStream<AgentStreamEvent>({
        async pull(controller) {
          await canSettle
          controller.enqueue({ type: 'tool_call_start', id: 'call-1', name: alias })
          output.toolCalls = { list: [{ name: alias }], count: 1 }
          output.providerTiming?.timeSegments?.push({
            type: 'tool',
            name: alias,
            startTime: 0,
            endTime: 1,
            duration: 1,
          })
          controller.enqueue({
            type: 'tool_call_end',
            id: 'call-1',
            name: alias,
            status: 'success',
          })
          controller.close()
        },
      }),
      execution: { success: true, output },
    }

    projectStreamingExecutionToolIdentities(response, identities)
    settleStream?.()
    const events = await readEvents(response.stream)

    expect(events).toEqual([
      { type: 'tool_call_start', id: 'call-1', name: 'gmail_send' },
      { type: 'tool_call_end', id: 'call-1', name: 'gmail_send', status: 'success' },
    ])
    expect(output.toolCalls?.list[0].name).toBe('gmail_send')
    expect(output.providerTiming?.timeSegments?.[0].name).toBe('gmail_send')
  })
})
