import { describe, expect, it } from 'vitest'
import { resourceMentionMatches } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'

describe('resourceMentionMatches', () => {
  it("keeps a file the server ranked for the query, though its name doesn't contain it", () => {
    const file = { id: 'wf_a', name: 'Quarterly-Report.md', matchedQuery: 'QRep' }
    expect(resourceMentionMatches(file, 'qrep')).toBe(true)
  })

  it('still filters by substring what no search matched for this query', () => {
    expect(
      resourceMentionMatches({ id: 'wf_a', name: 'notes.md', matchedQuery: 'old' }, 'qrep')
    ).toBe(false)
    expect(resourceMentionMatches({ id: 't1', name: 'Quarterly table' }, 'quarter')).toBe(true)
  })
})
