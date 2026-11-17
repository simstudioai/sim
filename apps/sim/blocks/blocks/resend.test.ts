import { describe, expect, it, vi } from 'vitest'
import { ResendBlock, ResendV2Block } from '@/blocks/blocks/resend'
import type { BlockConfig, BlockToolParamsContext } from '@/blocks/types'
import { collectBlockFieldIssues } from '@/serializer/index'

/** Lint checks fields against the real tool params, which vitest.setup.ts mocks empty. */
vi.unmock('@/tools/metadata')

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = ResendV2Block.tools.config?.params
  if (!mapper) throw new Error('Resend block has no params mapper')
  return mapper(params, context)
}

describe('Resend contact subscription status', () => {
  it.each([true, false])('keeps a model-sent boolean unsubscribed=%s on a tool call', (value) => {
    expect(
      mapParams(
        { contactId: 'jane@example.com', unsubscribed: value },
        { operation: 'update_contact' }
      ).unsubscribed
    ).toBe(value)
  })

  it.each([
    ['true', true],
    ['false', false],
    ['', undefined],
  ])('maps the canvas dropdown value %j to %j', (value, expected) => {
    expect(
      mapParams({ operation: 'create_contact', email: 'a@example.com', unsubscribed: value })
        .unsubscribed
    ).toBe(expected)
  })
})

describe('Resend list pagination limit', () => {
  it('keeps a model-sent numeric limit on a tool call', () => {
    expect(mapParams({ limit: 50 }, { operation: 'list_contacts' }).limit).toBe(50)
  })

  it('turns the canvas text limit into a number and drops a blank one', () => {
    expect(mapParams({ operation: 'list_domains', limit: ' 75 ' }).limit).toBe(75)
    expect(mapParams({ operation: 'list_domains', limit: '' }).limit).toBeUndefined()
  })
})

describe('Resend Create Broadcast recipient', () => {
  function missingFields(config: BlockConfig, values: Record<string, string>) {
    const params = {
      operation: 'create_broadcast',
      broadcastFrom: 'news@example.com',
      broadcastSubject: 'Hi',
      ...values,
    }
    const subBlocks = Object.fromEntries(
      Object.entries(params).map(([id, value]) => [id, { id, type: 'short-input' as const, value }])
    )
    const block = {
      id: 'b1',
      type: config.type,
      name: 'Resend',
      enabled: true,
      position: { x: 0, y: 0 },
      subBlocks,
      outputs: {},
      data: {},
    }
    return collectBlockFieldIssues(block, config, params, { mode: 'lint' }).missingRequiredFields
  }

  it.each([ResendBlock, ResendV2Block])(
    'flags Audience ID only when no segment is given',
    (config) => {
      expect(missingFields(config, { segmentId: '', audienceId: '' })).toContain('Audience ID')
      expect(missingFields(config, { segmentId: 'seg_1', audienceId: '' })).not.toContain(
        'Audience ID'
      )
      expect(missingFields(config, { segmentId: '', audienceId: 'aud_1' })).not.toContain(
        'Audience ID'
      )
    }
  )

  it.each([ResendBlock, ResendV2Block])(
    'publishes Audience ID as required only for the audience operations when no values are known',
    (config) => {
      const audienceId = config.subBlocks.find((subBlock) => subBlock.id === 'audienceId')
      const required = audienceId?.required
      if (typeof required !== 'function') throw new Error('Audience ID requirement is not dynamic')
      expect(required()).toEqual({
        field: 'operation',
        value: ['get_audience', 'delete_audience'],
      })
    }
  )
})
