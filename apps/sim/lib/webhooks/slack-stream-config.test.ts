import { describe, expect, it } from 'vitest'
import {
  normalizeSlackStreamResponseConfig,
  readSlackStreamResponseConfig,
  replaceSlackStreamAuthoringConfig,
} from '@/lib/webhooks/slack-stream-config'

const CHILD_WORKFLOW_ID = '11111111-1111-4111-8111-111111111111'

describe('Slack stream response config', () => {
  it('normalizes selected outputs and replaces authoring fields', () => {
    const providerConfig: Record<string, unknown> = {
      eventType: 'app_mention',
      streamResponse: true,
      streamOutputs: ['rootagent.content', `${CHILD_WORKFLOW_ID}.writer.result.value`],
      streamIncludeThinking: true,
      streamIncludeToolCalls: false,
      streamTaskTitle: '  Working  ',
      streamTaskDisplayMode: 'plan',
    }
    const normalized = normalizeSlackStreamResponseConfig(providerConfig, {
      'block-1': { id: 'block-1', name: 'Root Agent' },
    })
    replaceSlackStreamAuthoringConfig(providerConfig, normalized)

    expect(normalized).toEqual({
      enabled: true,
      outputConfigs: [
        { blockId: 'block-1', path: 'content' },
        { workflowId: CHILD_WORKFLOW_ID, blockId: 'writer', path: 'result.value' },
      ],
      includeThinking: true,
      includeToolCalls: false,
      taskTitle: 'Working',
      taskDisplayMode: 'plan',
      timelineSources: [],
      toolLabels: {},
    })
    expect(readSlackStreamResponseConfig(providerConfig)).toEqual(normalized)
    expect(providerConfig.streamResponse).toBeUndefined()
    expect(providerConfig.streamOutputs).toBeUndefined()
    expect(providerConfig.streamTaskTitle).toBeUndefined()
  })

  it('upgrades persisted configs with omitted or blank response status labels', () => {
    expect(
      readSlackStreamResponseConfig({
        streamResponseConfig: {
          enabled: true,
          outputConfigs: [{ blockId: 'block', path: 'content' }],
          includeThinking: false,
          includeToolCalls: true,
          taskDisplayMode: 'timeline',
        },
      })?.taskTitle
    ).toBe('Running')
    expect(
      readSlackStreamResponseConfig({
        streamResponseConfig: {
          enabled: true,
          outputConfigs: [{ blockId: 'block', path: 'content' }],
          includeThinking: false,
          includeToolCalls: true,
          taskTitle: '   ',
          taskDisplayMode: 'timeline',
        },
      })?.taskTitle
    ).toBe('Running')
  })

  it.each(['reaction_added', 'assistant_thread_started'])(
    'rejects unsupported streaming event %s and malformed output selectors',
    (eventType) => {
      expect(() =>
        normalizeSlackStreamResponseConfig(
          {
            eventType,
            streamResponse: true,
            streamOutputs: ['block.content'],
          },
          {}
        )
      ).toThrow('reply-capable')
      expect(() =>
        normalizeSlackStreamResponseConfig(
          {
            eventType: 'message',
            streamResponse: true,
            streamOutputs: ['block_content'],
          },
          {}
        )
      ).toThrow('Invalid Slack stream output selector')
    }
  )

  describe('timeline sources', () => {
    const blocks = {
      'agent-1': { id: 'agent-1', name: 'Analyst', type: 'agent' },
      'fn-1': { id: 'fn-1', name: 'Format Answer', type: 'function' },
    }

    it('normalizes block-level sources and tool labels, and reads them back', () => {
      const providerConfig: Record<string, unknown> = {
        eventType: 'message',
        streamResponse: true,
        streamOutputs: ['formatanswer.result'],
        streamTimelineSources: ['analyst.content', `${CHILD_WORKFLOW_ID}.analyst`],
        streamToolLabels: [
          { id: 'r1', cells: { Tool: ' lc_cur ', Label: ' Reading AWS cost data ' } },
          { id: 'r2', cells: { Tool: '', Label: 'ignored' } },
        ],
      }
      const normalized = normalizeSlackStreamResponseConfig(providerConfig, blocks)
      replaceSlackStreamAuthoringConfig(providerConfig, normalized)

      expect(normalized?.timelineSources).toEqual([
        { blockId: 'agent-1' },
        { workflowId: CHILD_WORKFLOW_ID, blockId: 'analyst' },
      ])
      expect(normalized?.toolLabels).toEqual({ lc_cur: 'Reading AWS cost data' })
      expect(readSlackStreamResponseConfig(providerConfig)).toEqual(normalized)
      expect(providerConfig.streamTimelineSources).toBeUndefined()
      expect(providerConfig.streamToolLabels).toBeUndefined()
    })

    it('reads configs deployed before timeline sources existed', () => {
      const config = readSlackStreamResponseConfig({
        streamResponseConfig: {
          enabled: true,
          outputConfigs: [{ blockId: 'block', path: 'content' }],
          includeThinking: false,
          includeToolCalls: true,
          taskDisplayMode: 'timeline',
        },
      })
      expect(config?.timelineSources).toEqual([])
      expect(config?.toolLabels).toEqual({})
    })

    it('rejects a block that is both an answer output and a timeline source', () => {
      expect(() =>
        normalizeSlackStreamResponseConfig(
          {
            eventType: 'message',
            streamResponse: true,
            streamOutputs: ['analyst.content'],
            streamTimelineSources: ['analyst'],
          },
          blocks
        )
      ).toThrow('both')
    })

    it('rejects a timeline source that is not an Agent block', () => {
      expect(() =>
        normalizeSlackStreamResponseConfig(
          {
            eventType: 'message',
            streamResponse: true,
            streamOutputs: ['analyst.content'],
            streamTimelineSources: ['formatanswer'],
          },
          blocks
        )
      ).toThrow('must be an Agent block')
    })

    it('rejects a timeline source path other than the Agent content', () => {
      expect(() =>
        normalizeSlackStreamResponseConfig(
          {
            eventType: 'message',
            streamResponse: true,
            streamOutputs: ['formatanswer.result'],
            streamTimelineSources: ['analyst.model'],
          },
          blocks
        )
      ).toThrow('timeline source')
    })
  })
})
