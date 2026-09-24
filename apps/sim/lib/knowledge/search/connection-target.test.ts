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

it('parses exact live connection and reconnect controls without an indexed connector', () => {
  const live = {
    type: 'link',
    provider: 'slack',
    connectorType: 'slack',
    connectionMode: 'live',
    optionId: 'slack-option',
    credentialId: 'account',
  }
  expect(parseSearchConnectionTargets(`<credential>${JSON.stringify(live)}</credential>`)).toEqual([
    live,
  ])
  for (const invalid of [
    { ...live, optionId: undefined },
    { ...live, connectorId: 'indexed' },
    { ...live, connectionMode: undefined },
  ]) {
    expect(
      parseSearchConnectionTargets(`<credential>${JSON.stringify(invalid)}</credential>`)
    ).toEqual([])
  }
})
