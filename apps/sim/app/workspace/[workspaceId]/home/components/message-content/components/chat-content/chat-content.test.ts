import { describe, expect, it } from 'vitest'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import { scalingRatioOver4x } from '@/app/workspace/[workspaceId]/home/components/message-content/components/scaling-test-helpers'

describe('sanitizeChatDisplayContent', () => {
  it('does not let an unmatched backtick run suppress later citations', () => {
    const prefix = 'Use `` for two backticks.\n'
    const tag = '<source>{"url":"https://example.com"}</source>'

    expect(sanitizeChatDisplayContent(`${prefix}\`${tag}\``)).toBe(`${prefix}${tag}`)
  })

  it.each(['\n\n', '\r\n\r\n', '\n \t\n'])(
    'does not pair prose runs across paragraph break %j',
    (separator) => {
      const tag = '<source>{"url":"https://example.com"}</source>'
      const before = `Use \`\` as a delimiter.${separator}`
      const after = `${separator}Another \`\` marker.`

      expect(sanitizeChatDisplayContent(`${before}\`${tag}\`${after}`)).toBe(
        `${before}${tag}${after}`
      )
    }
  )

  it.each(['```', '~~~'])(
    'does not close a %s fence with a different character or a shorter run',
    (fence) => {
      const tag = '<source>{"url":"https://example.com"}</source>'
      const otherFence = fence === '```' ? '~~~~' : '````'
      const block = `${fence}${fence[0]}\n${otherFence}\n\`${tag}\`\n${fence}\n\`${tag}\`\n${fence}${fence[0]}\n`

      expect(sanitizeChatDisplayContent(`${block}\`${tag}\``)).toBe(`${block}${tag}`)
    }
  )

  it('treats tag markers inside JSON strings as payload', () => {
    const payload = JSON.stringify({ snippet: 'Use `<source>` and `</source>` markers' })
    const chip = `<source>${payload}</source>`

    expect(sanitizeChatDisplayContent(`\`See ${chip}\``)).toBe(`See ${chip}`)
  })

  it('removes hidden internal references wrapped in inline code', () => {
    const content = 'Read `internal/tool-results/read-1.md` and found the issue.'

    expect(sanitizeChatDisplayContent(content)).toBe('Read  and found the issue.')
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
    // for every streamed chunk.
    //
    // Asserted as a scaling ratio, not a wall-clock ceiling — see
    // {@link scalingRatioOver4x} for why.
    expect(scalingRatioOver4x((content) => sanitizeChatDisplayContent(content))).toBeLessThan(8)
  })

  it('stays linear on repeated unclosed JSON chip bodies', () => {
    expect(
      scalingRatioOver4x((content) =>
        sanitizeChatDisplayContent(
          content.replaceAll('The <workspace_resource> tag is used here. ', '<source>{"snippet":"')
        )
      )
    ).toBeLessThan(8)
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

  it.each(['source', 'workspace_resource'])(
    'stays linear on repeated %s tags with unterminated JSON strings',
    (name) => {
      expect(
        scalingRatioOver4x(sanitizeChatDisplayContent, (times) =>
          `<${name}>{${String.fromCharCode(92, 34)}`.repeat(times)
        )
      ).toBeLessThan(8)
    }
  )

  it.each(['<source>"', '<source>{"key":"'])(
    'stays linear on repeated quoted payload prefix %s',
    (prefix) => {
      expect(
        scalingRatioOver4x(sanitizeChatDisplayContent, (times) => prefix.repeat(times))
      ).toBeLessThan(8)
    }
  )
})
