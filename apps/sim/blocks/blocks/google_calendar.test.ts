import { describe, expect, it } from 'vitest'
import { GoogleCalendarBlock } from '@/blocks/blocks/google_calendar'
import type { BlockConfig } from '@/blocks/types'

/** The block's `tools.config.params` mapper, which every block under test defines. */
function requireParamsMapper(block: BlockConfig) {
  const mapper = block.tools.config?.params
  if (!mapper) throw new Error(`${block.type} has no params mapper`)
  return mapper
}

/**
 * On an agent call the model supplies `timeZone` under the tool's own name; the dedicated
 * `listTimeZone` field is never rendered in the agent tool input.
 */
describe('GoogleCalendarBlock list timeZone', () => {
  const buildParams = requireParamsMapper(GoogleCalendarBlock)

  it('keeps the model timeZone on an agent list call', () => {
    const inputs = { operation: 'list', timeZone: 'America/New_York' }
    const mapped = buildParams(inputs, { operation: 'list' })
    expect({ ...inputs, ...mapped }.timeZone).toBe('America/New_York')
  })

  it('drops a Create/Update timeZone left over on the canvas under list', () => {
    const inputs = { operation: 'list', timeZone: 'America/New_York' }
    expect({ ...inputs, ...buildParams(inputs) }.timeZone).toBeUndefined()
  })
})
