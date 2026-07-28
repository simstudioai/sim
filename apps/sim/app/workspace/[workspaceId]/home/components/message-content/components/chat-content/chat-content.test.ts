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

  it('leaves prose that mentions the opener and the closer separately alone', () => {
    // The balanced unwrap reads a backticked opener, prose, and a backticked
    // closer as ONE wrapped tag, and strips the outer pair. This is the shape a
    // message explaining the tag syntax naturally takes.
    const content = 'Use `<workspace_resource>` then close with `</workspace_resource>` at the end.'

    expect(sanitizeChatDisplayContent(content)).toBe(content)
  })

  it('leaves a neighbouring code span alone', () => {
    // Only a backtick DIRECTLY against the tag is the tag's wrapping. Allowing
    // whitespace between let the pattern reach past the tag and take the
    // delimiter off an unrelated span, breaking its pair.
    const content =
      'Open `config.json` <workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource> then run `bun test`.'

    expect(sanitizeChatDisplayContent(content)).toBe(content)
  })

  it('leaves a code span sitting flush against the tag alone', () => {
    // No space between them, so the span's delimiter is directly against the
    // tag and a pattern looking for "a backtick beside a tag" cannot tell the
    // two apart. A single pass settles it: a span consumes its own delimiters as
    // the scan reaches them, and a trailing backtick is only taken as a stray
    // when no further backtick follows on the line.
    const before =
      'Open `config.json`<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource> ok'
    const after =
      'Open <workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource>`config.json` ok'
    const both =
      'Open `a`<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource>`b` ok'

    expect(sanitizeChatDisplayContent(before)).toBe(before)
    expect(sanitizeChatDisplayContent(after)).toBe(after)
    expect(sanitizeChatDisplayContent(both)).toBe(both)
  })

  it('does not break the closing fence of a code block containing a tag', () => {
    // Whitespace matching used to cross the newline and consume one of the three
    // closing backticks, so the block never closed and the rest of the message
    // rendered as code.
    const content =
      'Example:\n```md\n<workspace_resource>{"type":"file","path":"a.md","title":"a"}</workspace_resource>\n```\nDone.'

    expect(sanitizeChatDisplayContent(content)).toBe(content)
  })

  it('stays linear on a message that repeats the tag name without ever closing it', () => {
    // A lazy scan allowed to cross an opener restarts from every opener, which
    // is quadratic — 154ms for this input before the bound, on the main thread,
    // for every streamed chunk. Generous ceiling so the test pins the complexity
    // rather than the machine.
    const content = 'The <workspace_resource> tag is used here. '.repeat(4000)

    const startedAt = performance.now()
    sanitizeChatDisplayContent(content)
    expect(performance.now() - startedAt).toBeLessThan(50)
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
