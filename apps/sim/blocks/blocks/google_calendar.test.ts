import { describe, expect, it } from 'vitest'
import { GoogleCalendarBlock } from '@/blocks/blocks/google_calendar'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => GoogleCalendarBlock.tools.config?.params?.(inputs, context) ?? {}

/**
 * On an agent call the model supplies `timeZone` under the tool's own name; the dedicated
 * `listTimeZone` field is never rendered in the agent tool input.
 */
describe('GoogleCalendarBlock list timeZone', () => {
  it('keeps the model timeZone on an agent list call', () => {
    const inputs = { timeZone: 'America/New_York' }
    const mapped = buildParams(inputs, { operation: 'list' })
    expect({ ...inputs, ...mapped }.timeZone).toBe('America/New_York')
  })

  it('drops a Create/Update timeZone left over on the canvas under list', () => {
    const inputs = { operation: 'list', timeZone: 'America/New_York' }
    expect({ ...inputs, ...buildParams(inputs) }.timeZone).toBeUndefined()
  })
})

describe('GoogleCalendarBlock invite replaceExisting', () => {
  it('keeps a boolean replaceExisting the model sends on an agent invite call', () => {
    const inputs = { eventId: 'evt1', attendees: 'a@example.com', replaceExisting: true }
    const mapped = buildParams(inputs, { operation: 'invite' })
    expect({ ...inputs, ...mapped }.replaceExisting).toBe(true)
  })
})
