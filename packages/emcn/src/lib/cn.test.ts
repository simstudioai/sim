/**
 * `cn` merges every class string in the product, and the only thing standing
 * between a tailwind-merge bump and a silent restyle is the class-group
 * extension it is configured with. These cases pin the behaviour that config
 * exists for.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  describe("Sim's font-size class group", () => {
    /**
     * The whole reason `cn.ts` extends the `font-size` group: without it the
     * merger reads `text-small` as a colour, so it does not conflict with
     * `text-sm` and both survive — leaving CSS source order to pick the winner
     * instead of the caller's last argument.
     */
    it.each([
      ['text-sm text-small', 'text-small'],
      ['text-small text-sm', 'text-sm'],
      ['text-micro text-caption', 'text-caption'],
      ['text-caption text-micro', 'text-micro'],
      ['text-base text-md', 'text-md'],
      ['text-md text-base', 'text-base'],
      ['text-small text-md text-micro', 'text-micro'],
    ])('%s -> %s', (input, expected) => {
      expect(cn(input)).toBe(expected)
    })

    it('keeps a font size and a text colour together', () => {
      expect(cn('text-small text-[var(--text-body)]')).toBe('text-small text-[var(--text-body)]')
    })

    it('conflicts an arbitrary size with a named one', () => {
      expect(cn('text-[13px] text-small')).toBe('text-small')
    })

    it('resolves the custom sizes per variant, not across them', () => {
      expect(cn('hover:text-small hover:text-md')).toBe('hover:text-md')
      expect(cn('text-small hover:text-md')).toBe('text-small hover:text-md')
    })
  })

  describe('stock conflict resolution', () => {
    it.each([
      ['p-2 p-4', 'p-4'],
      ['px-2 p-4', 'p-4'],
      ['border border-2', 'border-2'],
      ['rounded-sm rounded-lg', 'rounded-lg'],
      ['bg-red-500 bg-[var(--surface-2)]', 'bg-[var(--surface-2)]'],
    ])('%s -> %s', (input, expected) => {
      expect(cn(input)).toBe(expected)
    })

    it('keeps non-conflicting utilities in order', () => {
      expect(cn('flex items-center gap-2')).toBe('flex items-center gap-2')
    })
  })

  describe('v4 syntax', () => {
    /**
     * An important utility does not conflict with its plain counterpart — they
     * are separate groups, so both survive. tailwind-merge behaves the same way
     * (`p-2 !p-4` -> `p-2 !p-4`), so this is parity, not a `cn` quirk.
     */
    it('does not conflict an important utility with its plain counterpart', () => {
      expect(cn('p-2 p-4!')).toBe('p-2 p-4!')
      expect(cn('p-2! p-4')).toBe('p-2! p-4')
    })

    it('still resolves two important utilities against each other', () => {
      expect(cn('p-2! p-4!')).toBe('p-4!')
    })

    it('scopes conflicts to the variant chain', () => {
      expect(cn('hover:border hover:border-2')).toBe('hover:border-2')
      expect(cn('border hover:border-2')).toBe('border hover:border-2')
    })

    it("resolves within Sim's hover-hover custom variant", () => {
      expect(cn('hover-hover:bg-red-500 hover-hover:bg-blue-500')).toBe('hover-hover:bg-blue-500')
    })

    it('handles arbitrary variants', () => {
      expect(cn('[&_svg]:size-3 [&_svg]:size-4')).toBe('[&_svg]:size-4')
    })
  })

  describe('clsx-style inputs', () => {
    it('accepts conditionals, arrays and objects', () => {
      expect(cn('p-2', false && 'p-4', undefined, null)).toBe('p-2')
      expect(cn(['flex', 'p-2'], { 'p-4': true, hidden: false })).toBe('flex p-4')
    })

    it('returns an empty string for no usable input', () => {
      expect(cn()).toBe('')
      expect(cn(false, null, undefined, '')).toBe('')
    })
  })
})
