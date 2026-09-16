/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  parseSearchConnectionTargets,
  searchConnectionPath,
} from '@/lib/knowledge/search/connection-target'

const target = {
  type: 'link',
  provider: 'google-email',
  connectorType: 'gmail',
  connectorId: 'source',
}
describe('shared Search connection tags', () => {
  it('parses complete arrays and deduplicates exact targets', () => {
    expect(
      parseSearchConnectionTargets(`<credential>${JSON.stringify([target, target])}</credential>`)
    ).toEqual([target])
  })
  it.each([
    { ...target, value: 'https://evil.test' },
    { ...target, organizationId: 'other' },
    { ...target, connectorId: undefined, credentialId: 'account' },
  ])('rejects model URLs, scope and incomplete reconnects', (forged) => {
    expect(
      parseSearchConnectionTargets(`<credential>${JSON.stringify(forged)}</credential>`)
    ).toEqual([])
  })
  it('holds partial and malformed tags until a complete validated target exists', () => {
    expect(parseSearchConnectionTargets(`<credential>${JSON.stringify(target)}`)).toEqual([])
    expect(parseSearchConnectionTargets('<credential>{oops}</credential>')).toEqual([])
  })
  it('links to the existing organization page using only the selected IDs', () => {
    expect(searchConnectionPath('org', target)).toBe(
      '/o/org/integrations?connectorType=gmail&connectorId=source'
    )
  })
})
