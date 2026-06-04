import { describe, expect, it } from 'vitest'
import { getCopilotToolDescription } from './descriptions'

describe('getCopilotToolDescription', () => {
  it.concurrent('returns the base description when hosted keys are not active', () => {
    expect(
      getCopilotToolDescription(
        {
          id: 'brandfetch_search',
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
          id: 'brandfetch_search',
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
          id: 'brandfetch_search',
          name: '',
          description: '',
          hosting: { apiKeyParam: 'apiKey' } as never,
        },
        { isHosted: true, fallbackName: 'brandfetch_search' }
      )
    ).toBe('brandfetch_search <note>API key is hosted by Sim.</note>')
  })

  it.concurrent('appends the email tagline instruction for Gmail tools when enabled', () => {
    expect(
      getCopilotToolDescription(
        {
          id: 'gmail_send',
          name: 'Gmail Send',
          description: 'Send emails using Gmail',
        },
        { appendEmailTagline: true }
      )
    ).toBe(
      'Send emails using Gmail <important>Always add the footer "sent with sim ai" to the end of the email body. Add 3 line breaks before the footer.</important>'
    )
  })

  it.concurrent('appends the email tagline instruction for Outlook tools when enabled', () => {
    expect(
      getCopilotToolDescription(
        {
          id: 'outlook_send',
          name: 'Outlook Send',
          description: 'Send emails using Outlook',
        },
        { appendEmailTagline: true }
      )
    ).toBe(
      'Send emails using Outlook <important>Always add the footer "sent with sim ai" to the end of the email body. Add 3 line breaks before the footer.</important>'
    )
  })

  it.concurrent('does not append the email tagline instruction for non-email tools', () => {
    expect(
      getCopilotToolDescription(
        {
          id: 'brandfetch_search',
          name: 'Brandfetch Search',
          description: 'Search for brands by company name',
        },
        { appendEmailTagline: true }
      )
    ).toBe('Search for brands by company name')
  })

  it.concurrent('does not append the email tagline instruction when disabled', () => {
    expect(
      getCopilotToolDescription(
        {
          id: 'gmail_send_v2',
          name: 'Gmail Send',
          description: 'Send emails using Gmail',
        },
        { appendEmailTagline: false }
      )
    ).toBe('Send emails using Gmail')
  })
})
