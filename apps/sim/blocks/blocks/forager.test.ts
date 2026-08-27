/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ForagerBlock } from '@/blocks/blocks/forager'

function mapParams(params: Record<string, unknown>): Record<string, unknown> {
  const mapper = ForagerBlock.tools.config.params
  if (!mapper) throw new Error('Forager block is missing tools.config.params')
  return mapper(params)
}

function subBlock(id: string) {
  const config = ForagerBlock.subBlocks.find((candidate) => candidate.id === id)
  if (!config) throw new Error(`Forager block is missing ${id}`)
  return config
}

describe('Forager block lookup requirements', () => {
  it('keeps alternate identifiers optional and explains the one-of requirements', () => {
    for (const id of ['personId', 'linkedinPublicIdentifier']) {
      expect(subBlock(id).required).toBe(false)
      expect(subBlock(id).description).toContain('Required unless')
    }
    for (const id of ['domain', 'organizationId', 'organizationLinkedinPublicIdentifier']) {
      expect(subBlock(id).required).toBe(false)
      expect(subBlock(id).description).toContain('Required unless')
    }
  })

  it.each([
    'forager_person_personal_emails',
    'forager_person_phone_numbers',
    'forager_person_work_emails',
    'forager_person_detail',
  ])('rejects %s before the handler when both person identifiers are missing', (operation) => {
    expect(() => mapParams({ operation, personId: null, linkedinPublicIdentifier: '  ' })).toThrow(
      /requires Person ID or LinkedIn Public Identifier/
    )
  })

  it('accepts either person identifier', () => {
    expect(
      mapParams({ operation: 'forager_person_detail', linkedinPublicIdentifier: 'jane-doe' })
    ).toEqual({ linkedinPublicIdentifier: 'jane-doe' })
    expect(mapParams({ operation: 'forager_person_detail', personId: '42' })).toEqual({
      personId: 42,
    })
  })

  it('rejects Website Detail before the handler when every lookup field is missing', () => {
    expect(() =>
      mapParams({
        operation: 'forager_website_detail',
        domain: '  ',
        organizationId: null,
        organizationLinkedinPublicIdentifier: '',
      })
    ).toThrow(/requires Domain, Organization ID, or Organization LinkedIn Public Identifier/)
  })

  it('accepts each Website Detail lookup alternative', () => {
    expect(mapParams({ operation: 'forager_website_detail', domain: 'example.com' })).toEqual({
      domain: 'example.com',
    })
    expect(mapParams({ operation: 'forager_website_detail', organizationId: '42' })).toEqual({
      organizationId: 42,
    })
    expect(
      mapParams({
        operation: 'forager_website_detail',
        organizationLinkedinPublicIdentifier: 'example-company',
      })
    ).toEqual({ organizationLinkedinPublicIdentifier: 'example-company' })
  })
})
