/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  edmAttachmentLink,
  edmDownloadLink,
  edmJobLink,
  validateEdmStagingLink,
} from '@/lib/internal/oracle-epm-enterprise-data-management/links'

const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const origin = 'https://edm.example.com/gateway'
const root = `${origin}/epm/rest/v1`
const client = createOracleEpmClient({ instanceUrl: origin, accessToken: 'dTpw' })
const envelope = (rel: string, href: string, method?: string) => ({
  links: [{ rel, href, ...(method ? { method } : {}) }],
})

describe('EDM workflow link admission', () => {
  it('accepts the public v1 job route while preserving a gateway base path', () => {
    expect(edmJobLink(client, envelope('results', `${root}/jobRuns/${id}`)).id).toBe(id)
  })
  it.each([
    `https://other.example.com/gateway/epm/rest/v1/jobRuns/${id}`,
    `http://edm.example.com/gateway/epm/rest/v1/jobRuns/${id}`,
    `https://edm.example.com/epm/rest/v1/jobRuns/${id}`,
    `${origin}/epm/ui-rest/v1/jobRuns/${id}`,
    `${root}/jobRuns/${id}?url=https://other.example.com`,
    `${root}/jobRuns/${id}#fragment`,
    `${root}/jobRuns/../applications`,
  ])('rejects an unsafe or unsupported job target: %s', (href) => {
    expect(() => edmJobLink(client, envelope('results', href))).toThrow()
  })
  it('rejects ambiguous relations and write methods before following a link', () => {
    const link = envelope('results', `${root}/jobRuns/${id}`)
    expect(() => edmJobLink(client, { links: [...link.links, ...link.links] })).toThrow()
    expect(() => edmJobLink(client, envelope('results', `${root}/jobRuns/${id}`, 'POST'))).toThrow()
  })
  it('binds attachment links to the requested request', () => {
    const href = `${root}/requests/${id}/attachments/${other}`
    expect(edmAttachmentLink(client, envelope('attachment', href), id)).toEqual({
      attachmentId: other,
      attachmentUri: href,
    })
    expect(() => edmAttachmentLink(client, envelope('attachment', href), other)).toThrow(
      'different request'
    )
  })
  it('validates the exact staged file name including spaces', () => {
    expect(() =>
      validateEdmStagingLink(
        client,
        envelope('file', `${root}/files/staging/account%20changes.csv`),
        'account changes.csv'
      )
    ).not.toThrow()
    expect(() =>
      validateEdmStagingLink(
        client,
        envelope('file', `${root}/files/staging/other.csv`),
        'account.csv'
      )
    ).toThrow('different staging file')
  })
  it('supports both documented temporary and staging download routes', () => {
    expect(
      edmDownloadLink(client, envelope('results', `${root}/files/temp/${id}?fileName=account.csv`))
        ?.fileName
    ).toBe('account.csv')
    expect(
      edmDownloadLink(client, envelope('results', `${root}/files/staging/account%20changes.csv`))
        ?.fileName
    ).toBe('account changes.csv')
  })
  it('does not interpret a public job-result JSON link as a downloadable file', () => {
    expect(edmDownloadLink(client, envelope('results', `${root}/jobRuns/${id}/result`))).toBeNull()
    expect(edmDownloadLink(client, { links: [] })).toBeNull()
  })
  it('does not turn an unsupported result URL into a staging fallback', () => {
    expect(() =>
      edmDownloadLink(client, envelope('results', 'https://other.example.com/account.csv'))
    ).toThrow('unsupported')
  })
})
