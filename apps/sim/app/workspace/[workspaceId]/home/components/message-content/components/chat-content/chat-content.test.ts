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

  it('leaves a backticked mention of the tag name alone', () => {
    // Unwrapping exists so stray backticks cannot stop a real chip rendering. A
    // MENTION is not a tag: there is no payload and no closing marker, just the
    // name written in prose. Stripping its opening backtick leaves the closing
    // one unpaired, which opens a code span that swallows the rest of the
    // message — every later `code` toggles to the wrong state.
    const content = 'The `<workspace_resource>` tag needs a real `path` to render.'

    expect(sanitizeChatDisplayContent(content)).toBe(content)
  })

  it('keeps backticks balanced across a message that mentions the tag repeatedly', () => {
    const content =
      'Use `<workspace_resource>` for files.\n\nThe `<workspace_resource>` chip needs an `id`.'
    const backticks = (text: string) => (text.match(/`/g) || []).length

    expect(backticks(sanitizeChatDisplayContent(content))).toBe(backticks(content))
  })

  it('still unwraps a real tag that carries a stray backtick on one side only', () => {
    // The case the unpaired strip is actually for: the model backticked the
    // opener but not the closer (or vice versa), which would block the chip.
    const leading =
      '`<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource> done'
    const trailing =
      '<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource>` done'

    expect(sanitizeChatDisplayContent(leading)).toBe(
      '<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource> done'
    )
    expect(sanitizeChatDisplayContent(trailing)).toBe(
      '<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource> done'
    )
  })
})
