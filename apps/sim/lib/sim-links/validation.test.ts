import { SIM_LINK_NAME_MAX_LENGTH } from '@sim/browser-extension-protocol'
import { describe, expect, it } from 'vitest'
import { simLinkNameSchema, suggestSimLinkName } from '@/lib/sim-links/validation'

describe('suggestSimLinkName', () => {
  it('turns a document title into a valid lower-case name', () => {
    const name = suggestSimLinkName('  Q3 Board Deck — Final (v2)!  ')
    expect(name).toBe('q3-board-deck-final-v2')
    expect(simLinkNameSchema.safeParse(name).success).toBe(true)
  })

  it('joins words across colons, dots, and other name punctuation with a single hyphen', () => {
    expect(suggestSimLinkName('Sim: Build and govern every AI agent')).toBe(
      'sim-build-and-govern-every-ai-agent'
    )
    expect(suggestSimLinkName('docs.sim.ai @ v2 ~ draft')).toBe('docs-sim-ai-v2-draft')
  })

  it('cuts a long title to the name limit without a trailing hyphen', () => {
    const word = 'a'.repeat(SIM_LINK_NAME_MAX_LENGTH - 1)
    const name = suggestSimLinkName(`${word} appendix`)
    expect(name).toBe(word)
    expect(simLinkNameSchema.safeParse(name).success).toBe(true)
  })

  it('suggests nothing when no letter or digit survives', () => {
    expect(suggestSimLinkName('「年度計画」')).toBe('')
    expect(suggestSimLinkName('... _-_ ...')).toBe('')
  })
})
