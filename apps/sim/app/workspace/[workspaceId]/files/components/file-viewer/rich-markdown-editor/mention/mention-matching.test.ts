import { describe, expect, it } from 'vitest'
import {
  mentionEmptyLabel,
  mentionItemMatches,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention-list'

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

describe('mentionEmptyLabel', () => {
  const file = { kind: 'file' as const, id: 'wf_a', label: 'a.md', group: 'Files' }

  it('reads as loading, not "No results", while the file search behind a query is settling', () => {
    expect(mentionEmptyLabel({ items: [file], filesPending: true })).toBe('Loading…')
  })

  it('says "No results" once the files for the query have landed', () => {
    expect(mentionEmptyLabel({ items: [file], filesPending: false })).toBe('No results')
  })
})
