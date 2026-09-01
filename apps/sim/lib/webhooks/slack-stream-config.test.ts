/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeSlackStreamResponseConfig,
  readSlackStreamResponseConfig,
  replaceSlackStreamAuthoringConfig,
} from '@/lib/webhooks/slack-stream-config'

describe('Slack stream response config', () => {
  it('normalizes selected outputs and replaces authoring fields', () => {
    const providerConfig: Record<string, unknown> = {
      eventType: 'app_mention',
      streamResponse: true,
      streamOutputs: ['block-1_content', 'block-2_result.value'],
      streamIncludeThinking: true,
      streamIncludeToolCalls: false,
      streamTaskTitle: '  Working  ',
      streamTaskDisplayMode: 'plan',
    }
    const normalized = normalizeSlackStreamResponseConfig(providerConfig)
    replaceSlackStreamAuthoringConfig(providerConfig, normalized)

    expect(normalized).toEqual({
      enabled: true,
      outputConfigs: [
        { blockId: 'block-1', path: 'content' },
        { blockId: 'block-2', path: 'result.value' },
      ],
      includeThinking: true,
      includeToolCalls: false,
      taskTitle: 'Working',
      taskDisplayMode: 'plan',
    })
    expect(readSlackStreamResponseConfig(providerConfig)).toEqual(normalized)
    expect(providerConfig.streamResponse).toBeUndefined()
    expect(providerConfig.streamOutputs).toBeUndefined()
    expect(providerConfig.streamTaskTitle).toBeUndefined()
  })

  it('defaults omitted or blank response status labels to Running', () => {
    expect(
      normalizeSlackStreamResponseConfig({
        eventType: 'message',
        streamResponse: true,
        streamOutputs: ['block_content'],
      })?.taskTitle
    ).toBe('Running')
    expect(
      normalizeSlackStreamResponseConfig({
        eventType: 'message',
        streamResponse: true,
        streamOutputs: ['block_content'],
        streamTaskTitle: '   ',
      })?.taskTitle
    ).toBe('Running')
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

  it('rejects non-reply events and malformed output selectors', () => {
    expect(() =>
      normalizeSlackStreamResponseConfig({
        eventType: 'reaction_added',
        streamResponse: true,
        streamOutputs: ['block_content'],
      })
    ).toThrow('reply-capable')
    expect(() =>
      normalizeSlackStreamResponseConfig({
        eventType: 'message',
        streamResponse: true,
        streamOutputs: ['content'],
      })
    ).toThrow('Invalid Slack stream output selector')
  })

  it('clears stale normalized config when streaming is disabled', () => {
    const providerConfig: Record<string, unknown> = {
      streamResponse: false,
      streamResponseConfig: { enabled: true },
    }
    replaceSlackStreamAuthoringConfig(
      providerConfig,
      normalizeSlackStreamResponseConfig(providerConfig)
    )
    expect(providerConfig.streamResponseConfig).toBeUndefined()
  })
})
