/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { byIntegrationPopularity, POPULAR_INTEGRATION_NAMES } from '@/blocks/integration-matcher'

const sortNames = (names: string[]) =>
  [...names]
    .map((name) => ({ name }))
    .sort(byIntegrationPopularity)
    .map((i) => i.name)

describe('byIntegrationPopularity', () => {
  it('leads with curated integrations instead of whatever sorts first alphabetically', () => {
    expect(sortNames(['1Password', 'Affinity', 'AgentMail', 'Slack'])[0]).toBe('Slack')
  })

  it('keeps the curated entries in their authored order, not alphabetical', () => {
    const curated = POPULAR_INTEGRATION_NAMES.slice(0, 4)
    expect(sortNames([...curated].reverse())).toEqual(curated)
  })

  it('sorts everything unranked alphabetically behind the curated set', () => {
    expect(sortNames(['Zoom', 'Affinity', 'Slack'])).toEqual(['Slack', 'Affinity', 'Zoom'])
  })

  it('matches case-insensitively so a display-name casing change cannot silently unrank one', () => {
    expect(sortNames(['Affinity', 'sLaCk'])[0]).toBe('sLaCk')
  })
})
