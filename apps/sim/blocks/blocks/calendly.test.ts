import { describe, expect, it } from 'vitest'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import type { BlockToolParamsContext } from '@/blocks/types'
import { listEventTypesTool } from '@/tools/calendly/list_event_types'
import type { ToolConfig } from '@/tools/types'

/**
 * Assertions run against `{ ...inputs, ...mapper(inputs, context) }`, the shape both the canvas
 * handler and the tool-call transform forward: a key the mapper leaves out keeps its raw value.
 */
describe('CalendlyBlock params mapper', () => {
  const mapper = CalendlyBlock.tools.config?.params
  if (!mapper) throw new Error('CalendlyBlock is missing its params mapper')

  const resolve = (inputs: Record<string, unknown>, context?: BlockToolParamsContext) => ({
    ...inputs,
    ...mapper(inputs, context),
  })

  const eventTypesUrl = (params: Record<string, unknown>) => {
    const tool: ToolConfig = listEventTypesTool
    const url = tool.request.url
    if (typeof url !== 'function') throw new Error('Expected a url builder')
    return url(params)
  }

  it('lists all event types on the canvas when the Active Only switch was turned off', () => {
    const params = resolve({
      operation: 'calendly_list_event_types',
      apiKey: 'k',
      user: 'user-1',
      active: false,
    })

    expect(eventTypesUrl(params)).not.toContain('active=')
  })

  it('lists all event types on a tool call whose stored row has the switch off', () => {
    const params = resolve(
      { apiKey: 'k', user: 'user-1', active: false },
      { operation: 'calendly_list_event_types' }
    )

    expect(eventTypesUrl(params)).not.toContain('active=')
  })

  it('still filters to active event types when the switch is on', () => {
    const params = resolve({
      operation: 'calendly_list_event_types',
      apiKey: 'k',
      user: 'user-1',
      active: true,
    })

    expect(eventTypesUrl(params)).toContain('active=true')
  })
})
