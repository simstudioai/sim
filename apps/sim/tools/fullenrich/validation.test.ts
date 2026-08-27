/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { lookupPersonTool } from '@/tools/fullenrich/lookup_person'
import { fullEnrichWebhookUrlSchema } from '@/tools/fullenrich/schemas'
import { searchPeopleTool } from '@/tools/fullenrich/search_people'
import { startContactEnrichmentTool } from '@/tools/fullenrich/start_contact_enrichment'
import { startReverseEmailTool } from '@/tools/fullenrich/start_reverse_email'
import type {
  FullEnrichLookupPersonParams,
  FullEnrichSearchParams,
  FullEnrichStartContactEnrichmentParams,
  FullEnrichStartReverseEmailParams,
} from '@/tools/fullenrich/types'
import { requireFullEnrichString } from '@/tools/fullenrich/utils'

const CONTACT_PARAMS: FullEnrichStartContactEnrichmentParams = {
  apiKey: 'key',
  name: 'Contacts',
  data: [
    {
      linkedin_url: 'https://www.linkedin.com/in/ada',
      enrich_fields: ['contact.work_emails'],
    },
  ],
}

const REVERSE_EMAIL_PARAMS: FullEnrichStartReverseEmailParams = {
  apiKey: 'key',
  name: 'Reverse email',
  data: [{ email: 'ada@example.com' }],
}

function buildContactBody(params: FullEnrichStartContactEnrichmentParams): unknown {
  const buildBody = startContactEnrichmentTool.request.body
  if (!buildBody) throw new Error('FullEnrich contact request body is not configured')
  return buildBody(params)
}

function buildReverseEmailBody(params: FullEnrichStartReverseEmailParams): unknown {
  const buildBody = startReverseEmailTool.request.body
  if (!buildBody) throw new Error('FullEnrich reverse-email request body is not configured')
  return buildBody(params)
}

function buildSearchPeopleBody(params: FullEnrichSearchParams): unknown {
  const buildBody = searchPeopleTool.request.body
  if (!buildBody) throw new Error('FullEnrich people-search request body is not configured')
  return buildBody(params)
}

function buildLookupPersonBody(params: FullEnrichLookupPersonParams): unknown {
  const buildBody = lookupPersonTool.request.body
  if (!buildBody) throw new Error('FullEnrich person-lookup request body is not configured')
  return buildBody(params)
}

describe('FullEnrich request validation', () => {
  it('allows HTTPS webhook URLs and rejects cleartext URLs', () => {
    expect(fullEnrichWebhookUrlSchema.parse('https://example.com/fullenrich')).toBe(
      'https://example.com/fullenrich'
    )
    expect(() => fullEnrichWebhookUrlSchema.parse('http://example.com/fullenrich')).toThrow(
      'Webhook URL must use HTTPS'
    )
  })

  it('validates both webhook endpoints for both asynchronous tools', () => {
    const cleartextWebhookCases: Array<[string, () => unknown]> = [
      [
        'contact completion webhook',
        () => buildContactBody({ ...CONTACT_PARAMS, webhookUrl: 'http://example.com/batch' }),
      ],
      [
        'contact item webhook',
        () =>
          buildContactBody({
            ...CONTACT_PARAMS,
            contactFinishedWebhookUrl: 'http://example.com/contact',
          }),
      ],
      [
        'reverse-email completion webhook',
        () =>
          buildReverseEmailBody({
            ...REVERSE_EMAIL_PARAMS,
            webhookUrl: 'http://example.com/batch',
          }),
      ],
      [
        'reverse-email item webhook',
        () =>
          buildReverseEmailBody({
            ...REVERSE_EMAIL_PARAMS,
            contactFinishedWebhookUrl: 'http://example.com/contact',
          }),
      ],
    ]

    for (const [label, buildBody] of cleartextWebhookCases) {
      expect(buildBody, label).toThrow('Webhook URL must use HTTPS')
    }
  })

  it('does not silently omit provided empty webhook endpoints', () => {
    expect(() => buildContactBody({ ...CONTACT_PARAMS, webhookUrl: '' })).toThrow()
    expect(() =>
      buildReverseEmailBody({ ...REVERSE_EMAIL_PARAMS, contactFinishedWebhookUrl: '' })
    ).toThrow()
  })

  it('normalizes optional people-search pagination and omits empty values', () => {
    expect(
      buildSearchPeopleBody({
        apiKey: 'key',
        offset: '12' as never,
        limit: '25' as never,
      })
    ).toEqual({ offset: 12, limit: 25 })
    expect(
      buildSearchPeopleBody({
        apiKey: 'key',
        offset: '' as never,
        limit: '   ' as never,
      })
    ).toEqual({})
  })

  it('rejects invalid normalized people-search pagination', () => {
    expect(() =>
      buildSearchPeopleBody({ apiKey: 'key', offset: 'not-a-number' as never })
    ).toThrow()
    expect(() => buildSearchPeopleBody({ apiKey: 'key', limit: '101' as never })).toThrow()
    expect(() => buildSearchPeopleBody({ apiKey: 'key', offset: false as never })).toThrow()
  })

  it('requires a person identifier instead of accepting company-only lookup data', () => {
    expect(() => buildLookupPersonBody({ apiKey: 'key', companyDomain: 'example.com' })).toThrow(
      'At least one person identifier is required'
    )
    expect(
      buildLookupPersonBody({
        apiKey: 'key',
        personName: 'Ada Lovelace',
        companyDomain: 'example.com',
      })
    ).toEqual({ person_name: 'Ada Lovelace', company_domain: 'example.com' })
  })

  it('normalizes optional person-lookup IDs without dropping zero', () => {
    expect(
      buildLookupPersonBody({
        apiKey: 'key',
        personProfessionalNetworkId: 0,
        companyProfessionalNetworkId: '42' as never,
      })
    ).toEqual({
      person_professional_network_id: 0,
      company_professional_network_id: 42,
    })
  })

  it('rejects whitespace-only required response strings', () => {
    expect(() => requireFullEnrichString('   ', 'FullEnrich response ID')).toThrow(
      'FullEnrich response ID must be a non-empty string'
    )
  })
})
