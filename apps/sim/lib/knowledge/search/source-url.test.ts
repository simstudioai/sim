import { describe, expect, it } from 'vitest'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/source-url'

describe('knowledge source URLs', () => {
  it.each([
    '',
    'file:///tmp/app',
    'javascript:alert(1)',
    'data:text/html,secret',
    'https://user:secret@source.test/doc',
    'https://source.test/with\nnewline',
    'https://source.test\\@evil.test/doc',
    '/relative/path',
    'https:source.test/doc',
    '//source.test/doc',
    ' https://source.test/doc',
  ])('rejects unsafe provider link %s', (sourceUrl) => {
    expect(isKnowledgeSourceUrl(sourceUrl)).toBe(false)
  })

  it('accepts a provider link with its query and fragment intact', () => {
    expect(
      isKnowledgeSourceUrl('https://docs.google.com/document/d/abc/edit?tab=t.0#heading')
    ).toBe(true)
  })
})
