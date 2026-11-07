/**
 * `cn` merges every class string in the product, and the only thing standing
 * between a tailwind-merge bump and a silent restyle is the class-group
 * extension it is configured with. These cases pin the behaviour that config
 * exists for.
 */
import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  describe("Sim's font-size class group", () => {
    it('conflicts an arbitrary size with a named one', () => {
      expect(cn('text-[13px] text-small')).toBe('text-small')
    })

    it('resolves the custom sizes per variant, not across them', () => {
      expect(cn('hover:text-small hover:text-md')).toBe('hover:text-md')
      expect(cn('text-small hover:text-md')).toBe('text-small hover:text-md')
    })
  })
})
