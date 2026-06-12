/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sanitizeChatDisplayContent } from './chat-sanitize'

describe('sanitizeChatDisplayContent', () => {
  it('unwraps workspace resource tags from inline code spans', () => {
    const content =
      '`I updated <workspace_resource>{"type":"workflow","id":"wf-1","title":"Workflow"}</workspace_resource>.`'

    expect(sanitizeChatDisplayContent(content)).toBe(
      'I updated <workspace_resource>{"type":"workflow","id":"wf-1","title":"Workflow"}</workspace_resource>.'
    )
  })

  it('removes hidden internal references wrapped in inline code', () => {
    const content = 'Read `internal/tool-results/read-1.md` and found the issue.'

    expect(sanitizeChatDisplayContent(content)).toBe('Read  and found the issue.')
  })
})
