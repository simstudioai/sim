import { describe, expect, it } from 'vitest'
import { parsePlanePage, planePageDocument, planeWorkItemDocument } from '@/connectors/plane/utils'

const CONFIG = {
  workspaceSlug: 'example',
  projectId: 'project-a',
  webUrl: 'https://plane.example.com/prefix',
}

describe('Plane connector listing integrity', () => {
  it.each([
    {},
    { results: [] },
    { results: [], next_page_results: true },
    { results: [], next_page_results: true, next_cursor: '' },
  ])('rejects incomplete pagination instead of treating it as exhaustion', (body) => {
    expect(() => parsePlanePage(body)).toThrow()
  })
  it('stops when the provider says exhausted even though an offset cursor is present', () => {
    expect(
      parsePlanePage({ results: [], next_page_results: false, next_cursor: '100:1:0' }).nextCursor
    ).toBeUndefined()
  })
  it('rejects a cursor that repeats the current page', () => {
    expect(() =>
      parsePlanePage({ results: [], next_page_results: true, next_cursor: '100:1:0' }, '100:1:0')
    ).toThrow()
  })
})

describe('Plane knowledge content', () => {
  it('keeps the same page version hash before and after content hydration', () => {
    const page = { id: 'page-a', name: 'Example page', updated_at: '2026-01-01T00:00:00Z' }
    const stub = planePageDocument(page, CONFIG, true)
    const full = planePageDocument(
      { ...page, description_html: '<p>Useful <b>content</b></p>' },
      CONFIG,
      false
    )
    expect(stub.contentDeferred).toBe(true)
    expect(stub.content).toBe('')
    expect(full.contentHash).toBe(stub.contentHash)
    expect(full.content).toContain('Useful content')
    expect(full.content).not.toContain('<p>')
  })
  it('extracts work item HTML and expanded names without exposing markup', async () => {
    const document = await planeWorkItemDocument(
      {
        id: 'item-a',
        name: 'Fix setup',
        sequence_id: 7,
        description_html: '<p>Keep <strong>code</strong> examples</p>',
        priority: 'high',
        state: { id: 'state-a', name: 'In Progress' },
        assignees: [{ id: 'user-a', display_name: 'Person' }],
        labels: [{ id: 'label-a', name: 'Bug' }],
      },
      CONFIG
    )
    expect(document.content).toContain('Keep code examples')
    expect(document.content).toContain('In Progress')
    expect(document.content).toContain('Person')
    expect(document.content).not.toContain('<strong>')
  })
})
