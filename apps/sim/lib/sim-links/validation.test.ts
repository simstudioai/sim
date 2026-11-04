import { SIM_LINK_NAME_MAX_LENGTH } from '@sim/browser-extension-protocol'
import { describe, expect, it } from 'vitest'
import { simLinkNameSchema, suggestSimLinkName } from '@/lib/sim-links/validation'

describe('suggestSimLinkName', () => {
  it('turns a document title into a valid lower-case name', () => {
    const name = suggestSimLinkName('  Q3 Board Deck — Final (v2)!  ')
    expect(name).toBe('q3-board-deck-final-v2')
    expect(simLinkNameSchema.safeParse(name).success).toBe(true)
  })

  it('cuts a long title to the name limit without a trailing hyphen', () => {
    const word = 'a'.repeat(SIM_LINK_NAME_MAX_LENGTH - 1)
    const name = suggestSimLinkName(`${word} appendix`)
    expect(name).toBe(word)
    expect(simLinkNameSchema.safeParse(name).success).toBe(true)
  })

  it('suggests nothing when the title has no character a name can hold', () => {
    expect(suggestSimLinkName('「年度計画」')).toBe('')
  })
})
