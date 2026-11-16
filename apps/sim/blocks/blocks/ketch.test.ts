import { describe, expect, it } from 'vitest'
import { KetchBlock } from '@/blocks/blocks/ketch'

const buildParams = KetchBlock.tools.config?.params
if (!buildParams) throw new Error('KetchBlock has no params mapper')

describe('KetchBlock', () => {
  /**
   * An agent tool call passes the operation only in `context`; a purposes map the
   * model sends as JSON text must reach the tool as an object, like the canvas sends it.
   */
  it('parses a JSON-text purposes map on an agent tool call', () => {
    const args = {
      organizationCode: 'org',
      propertyCode: 'web',
      environmentCode: 'production',
      identities: { email: 'a@example.com' },
      purposes: '{"analytics":{"allowed":"granted"}}',
    }

    expect({ ...args, ...buildParams(args, { operation: 'set_consent' }) }.purposes).toEqual({
      analytics: { allowed: 'granted' },
    })
  })
})
