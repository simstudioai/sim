import { describe, expect, it } from 'vitest'
import { getCopilotToolDescription } from '@/lib/copilot/tool-descriptions'

describe('getCopilotToolDescription', () => {
  it.concurrent('returns the base description when hosted keys are not active', () => {
    expect(
      getCopilotToolDescription(
        {
          name: 'Brandfetch Search',
          description: 'Search for brands by company name',
          hosting: { apiKeyParam: 'apiKey' } as never,
        },
        { isHosted: false }
      )
    ).toBe('Search for brands by company name')
  })

  it.concurrent('appends the hosted API key note when the tool supports hosting', () => {
    expect(
      getCopilotToolDescription(
        {
          name: 'Brandfetch Search',
          description: 'Search for brands by company name',
          hosting: { apiKeyParam: 'apiKey' } as never,
        },
        { isHosted: true }
      )
    ).toBe('Search for brands by company name <note>API key is hosted by Sim.</note>')
  })

  it.concurrent('uses the fallback name when no description exists', () => {
    expect(
      getCopilotToolDescription(
        {
          name: '',
          description: '',
          hosting: { apiKeyParam: 'apiKey' } as never,
        },
        { isHosted: true, fallbackName: 'brandfetch_search' }
      )
    ).toBe('brandfetch_search <note>API key is hosted by Sim.</note>')
  })
})
