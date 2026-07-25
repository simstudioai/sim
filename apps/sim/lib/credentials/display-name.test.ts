/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DISPLAY_NAME_MAX_LENGTH,
  defaultCredentialDisplayName,
} from '@/lib/credentials/display-name'

const NONE: ReadonlySet<string> = new Set()

describe('defaultCredentialDisplayName', () => {
  it("produces {Name}'s {Service} when the user name is known", () => {
    expect(defaultCredentialDisplayName('Justin', 'Gmail', NONE)).toBe("Justin's Gmail")
  })

  it('trims surrounding whitespace from the user name', () => {
    expect(defaultCredentialDisplayName('  Justin  ', 'Gmail', NONE)).toBe("Justin's Gmail")
  })

  it.each([null, undefined, '', '   '])('falls back to My {Service} for user name %j', (name) => {
    expect(defaultCredentialDisplayName(name, 'Gmail', NONE)).toBe('My Gmail')
  })

  it('appends " 2" when the base name is taken', () => {
    const taken = new Set(["justin's gmail"])
    expect(defaultCredentialDisplayName('Justin', 'Gmail', taken)).toBe("Justin's Gmail 2")
  })

  it('skips taken numbered names and picks the next free slot', () => {
    const taken = new Set(["justin's gmail", "justin's gmail 2", "justin's gmail 3"])
    expect(defaultCredentialDisplayName('Justin', 'Gmail', taken)).toBe("Justin's Gmail 4")
  })

  it('compares collisions case-insensitively', () => {
    const taken = new Set(["justin's gmail"])
    expect(defaultCredentialDisplayName('JUSTIN', 'Gmail', taken)).toBe("JUSTIN's Gmail 2")
  })

  it('numbers the My {Service} fallback on collision too', () => {
    const taken = new Set(['my gmail'])
    expect(defaultCredentialDisplayName(null, 'Gmail', taken)).toBe('My Gmail 2')
  })

  it('truncates a long user name so name + suffix + disambiguator fit the max length', () => {
    const longName = 'x'.repeat(400)
    const result = defaultCredentialDisplayName(longName, 'Gmail', NONE)

    expect(result.endsWith("'s Gmail")).toBe(true)
    expect(result.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX_LENGTH)

    const taken = new Set([result.toLowerCase()])
    const numbered = defaultCredentialDisplayName(longName, 'Gmail', taken)
    expect(numbered).toBe(`${result} 2`)
    expect(numbered.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX_LENGTH)
  })
})
