import { describe, expect, it } from 'vitest'
import { mentionItemMatches } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention-list'

describe('mentionItemMatches', () => {
  const file = { kind: 'file' as const, id: 'wf_a', label: 'Quarterly-Report.md', group: 'Files' }

  it("keeps a file the server matched for the query though its name doesn't contain it", () => {
    expect(mentionItemMatches({ ...file, matchedQuery: 'qrep' }, 'qrep')).toBe(true)
  })

  it('filters by substring an item no search matched for this query', () => {
    expect(mentionItemMatches({ ...file, matchedQuery: 'older' }, 'qrep')).toBe(false)
    expect(mentionItemMatches(file, 'report')).toBe(true)
  })
})
