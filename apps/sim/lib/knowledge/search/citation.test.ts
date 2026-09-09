/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  createKnowledgeDocumentCitation,
  isKnowledgeSourceUrl,
} from '@/lib/knowledge/search/citation'

const input = {
  scope: { kind: 'workspace', workspaceId: 'workspace/a' } as const,
  knowledgeBaseId: 'kb/b',
  documentId: 'doc/c',
  baseUrl: 'https://www.sim.ai',
  sourceUrl: 'https://docs.google.com/document/d/abc/edit?tab=t.0#heading',
}

describe('knowledge citations', () => {
  it('preserves safe provider paths, queries, and fragments', () => {
    expect(createKnowledgeDocumentCitation(input)).toEqual({
      citationId: 'document:doc/c',
      citationUrl: input.sourceUrl,
    })
  })

  it.each([
    null,
    '',
    'javascript:alert(1)',
    'data:text/html,secret',
    'https://user:secret@source.test/doc',
    'https://source.test/with\nnewline',
    'https://source.test\\@evil.test/doc',
    '/relative/path',
    'https:source.test/doc',
    '//source.test/doc',
  ])('uses a scoped Sim link when the source URL is %s', (sourceUrl) => {
    expect(createKnowledgeDocumentCitation({ ...input, sourceUrl }).citationUrl).toBe(
      'https://www.sim.ai/workspace/workspace%2Fa/knowledge/kb%2Fb/doc%2Fc'
    )
  })

  it('links organization documents under their own organization', () => {
    expect(
      createKnowledgeDocumentCitation({
        ...input,
        scope: { kind: 'organization', organizationId: 'org/a' },
        sourceUrl: null,
      }).citationUrl
    ).toBe('https://www.sim.ai/o/org%2Fa/knowledge/kb%2Fb/doc%2Fc')
  })

  it.each(['file:///tmp/app', 'javascript:alert(1)', 'https://secret@sim.ai'])(
    'rejects unsafe application URL %s',
    (baseUrl) => {
      expect(() => createKnowledgeDocumentCitation({ ...input, baseUrl })).toThrow(
        'Invalid citation base URL'
      )
    }
  )

  it('rejects whitespace in exact provider references', () => {
    expect(isKnowledgeSourceUrl(` ${input.sourceUrl}`)).toBe(false)
  })
})
