import { describe, expect, it } from 'vitest'
import { localSelectorAttachments } from '@/lib/selectors/client/local'
import { selectorManifest } from '@/lib/selectors/manifest'
import { serverSelectorRegistry } from '@/lib/selectors/server/registry'

describe('selector manifest', () => {
  it('keeps the completed migration inventory exhaustive and legacy-free', () => {
    const classifications = Object.values(selectorManifest).map((entry) => entry.classification)
    const count = (classification: (typeof classifications)[number]) =>
      classifications.filter((value) => value === classification).length

    expect(Object.keys(selectorManifest)).toHaveLength(93)
    expect(count('provider-server')).toBe(81)
    expect(count('internal-server')).toBe(11)
    expect(count('local')).toBe(1)
    expect(classifications).not.toContain('provider-legacy')
  })

  it('attaches every manifest key exactly once on its declared execution side', () => {
    const entries = Object.entries(selectorManifest)
    const expectedServerKeys = entries
      .filter(([, entry]) => entry.classification !== 'local')
      .map(([key]) => key)
      .sort()
    const expectedLocalKeys = entries
      .filter(([, entry]) => entry.classification === 'local')
      .map(([key]) => key)
      .sort()

    expect(Object.keys(serverSelectorRegistry).sort()).toEqual(expectedServerKeys)
    expect(Object.keys(localSelectorAttachments).sort()).toEqual(expectedLocalKeys)

    const providerKeys = entries
      .filter(([, entry]) => entry.classification === 'provider-server')
      .map(([key]) => key)
    const rawConnectionKeys = providerKeys.filter(
      (key) => !serverSelectorRegistry[key as keyof typeof serverSelectorRegistry].credential
    )
    expect(providerKeys).toHaveLength(81)
    expect(rawConnectionKeys.sort()).toEqual([
      'cloudwatch.logGroups',
      'cloudwatch.logStreams',
      'imap.mailboxes',
    ])
  })
})
