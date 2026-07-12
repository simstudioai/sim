/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { AshbyBlock } from './ashby'

describe('AshbyBlock', () => {
  const buildParams = (operation: string, extra: Record<string, unknown>) => ({
    operation,
    ...extra,
  })

  describe('alternateEmailAddresses parsing (create_candidate)', () => {
    it('parses a comma-separated string into an array', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('create_candidate', {
          alternateEmailAddresses: 'a@x.com, b@x.com',
        })
      )
      expect(result.alternateEmailAddresses).toEqual(['a@x.com', 'b@x.com'])
    })

    it('parses a JSON array string into an array', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('create_candidate', {
          alternateEmailAddresses: '["a@x.com","b@x.com"]',
        })
      )
      expect(result.alternateEmailAddresses).toEqual(['a@x.com', 'b@x.com'])
    })

    it('omits the field entirely when empty', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('create_candidate', { alternateEmailAddresses: '' })
      )
      expect(result.alternateEmailAddresses).toBeUndefined()
    })
  })

  describe('socialLinks parsing (update_candidate)', () => {
    it('parses a JSON array of link objects', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('update_candidate', {
          socialLinks: '[{"type":"Twitter","url":"https://twitter.com/jane"}]',
        })
      )
      expect(result.socialLinks).toEqual([{ type: 'Twitter', url: 'https://twitter.com/jane' }])
    })

    it('omits the field when the JSON is malformed', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('update_candidate', { socialLinks: 'not json' })
      )
      expect(result.socialLinks).toBeUndefined()
    })
  })
})
