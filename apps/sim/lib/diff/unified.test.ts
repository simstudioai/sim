import { describe, expect, it } from 'vitest'
import { matchUnifiedDiff, parseUnifiedDiff } from '@/lib/diff/unified'

const runbook = `--- sim:file/wf_runbook
+++ sim:file/wf_runbook
@@ Re-authorizing @@
 ## Re-authorizing
-Tokens never expire, so rotation is not required.
+Tokens rotate every 12h; the refresh job handles it.`

describe('parseUnifiedDiff', () => {
  it('reads the source from sim: header paths and hunks without line numbers', () => {
    const diff = parseUnifiedDiff(runbook)
    expect(diff.source).toEqual({ kind: 'file', fileId: 'wf_runbook' })
    expect(diff.hunks).toEqual([
      {
        heading: 'Re-authorizing',
        lines: [
          { type: 'context', text: '## Re-authorizing' },
          { type: 'del', text: 'Tokens never expire, so rotation is not required.' },
          { type: 'add', text: 'Tokens rotate every 12h; the refresh job handles it.' },
        ],
      },
    ])
  })

  it('numbers lines from git hunk headers and skips git metadata', () => {
    const diff = parseUnifiedDiff(
      'diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -10,2 +10,2 @@ fn\n keep\n-old\n+new\n\\ No newline at end of file'
    )
    expect(diff.source).toBeNull()
    expect(diff.hunks[0].heading).toBe('fn')
    expect(diff.hunks[0].lines).toEqual([
      { type: 'context', text: 'keep', oldLine: 10, newLine: 10 },
      { type: 'del', text: 'old', oldLine: 11, newLine: undefined },
      { type: 'add', text: 'new', oldLine: undefined, newLine: 11 },
    ])
  })

  it('reads knowledge document sources', () => {
    expect(
      parseUnifiedDiff('--- sim:knowledge/kb_1/doc_2\n+++ sim:knowledge/kb_1/doc_2\n-a\n+b').source
    ).toEqual({ kind: 'knowledge', knowledgeBaseId: 'kb_1', documentId: 'doc_2' })
  })

  it.each([
    [
      'two different sources',
      '--- sim:file/a\n+++ sim:file/b\n-x\n+y',
      'must name the same resource',
    ],
    ['a knowledge source without a document', '--- sim:knowledge/kb_1\n-x\n+y', 'sim:knowledge/'],
    ['a line without a marker', '@@ x @@\n-a\nplain', 'Line 3'],
    ['no changes', ' just context', 'at least one + or - line'],
  ])('rejects %s', (_, text, message) => {
    expect(() => parseUnifiedDiff(text)).toThrow(message)
  })
})

describe('matchUnifiedDiff', () => {
  const diff = parseUnifiedDiff(runbook)

  it('is current when the result is in the source, wherever it moved', () => {
    expect(
      matchUnifiedDiff(diff, [
        '# Slack\n\nIntro moved things around.\n\n## Re-authorizing\nTokens rotate every 12h;   the refresh job handles it.\n',
      ])
    ).toBe('current')
  })

  it('is proposed while the source still holds the original', () => {
    expect(
      matchUnifiedDiff(diff, [
        '## Re-authorizing\nTokens never expire, so rotation is not required.',
      ])
    ).toBe('proposed')
  })

  it('is outdated when the source matches neither side', () => {
    expect(matchUnifiedDiff(diff, ['## Re-authorizing\nTokens rotate hourly.'])).toBe('outdated')
  })

  it('matches across stored segments', () => {
    expect(
      matchUnifiedDiff(diff, [
        '## Re-authorizing',
        'Tokens rotate every 12h; the refresh job handles it.',
      ])
    ).toBe('current')
  })
})
