import { describe, expect, it } from 'vitest'
import { ChatMarkdownStream } from './chat-markdown.js'

const ESC = String.fromCharCode(27)

describe('ChatMarkdownStream', () => {
  it('styles headings, emphasis, lists, quotes, inline code, and fences across chunks', () => {
    const stream = new ChatMarkdownStream(true)
    const output = [
      stream.push('## Work'),
      stream.push('space\n- **default'),
      stream.push('-agent** with `code`\n> note\n```ts\nconst x = 1\n```'),
      stream.finish(),
    ].join('')

    expect(output).toContain(`${ESC}[1mWorkspace`)
    expect(output).toContain(`${ESC}[2m•${ESC}[0m `)
    expect(output).toContain('default-agent')
    expect(output).not.toContain('**')
    expect(output).not.toContain('`code`')
    expect(output).toContain(`${ESC}[2m│${ESC}[0m note`)
    expect(output).toContain(`${ESC}[2m┌─ ts${ESC}[0m`)
    expect(output).toContain(`${ESC}[2mconst x = 1${ESC}[0m`)
    expect(output).toContain(`${ESC}[2m└─${ESC}[0m`)
  })

  it('renders workspace summaries without exposing Markdown or styling identifier underscores', () => {
    const stream = new ChatMarkdownStream(true)
    const output = [
      stream.push("Here's what's in your workspace:\n\n**Workflows (3)**\n- forceful-arm\n"),
      stream.push(
        '- Table: cobalt_cloud\n- File: Mothership_Capability_Overview.pptx\n- **default-agent**'
      ),
      stream.finish(),
    ].join('')

    expect(output).toContain(`${ESC}[1mWorkflows (3)${ESC}[0m`)
    expect(output).toContain('cobalt_cloud')
    expect(output).toContain('Mothership_Capability_Overview.pptx')
    expect(output).toContain('default-agent')
    expect(output).not.toContain('**')
    expect(output).not.toContain(`${ESC}[3mcloud`)
    expect(output).not.toContain(`${ESC}[3mCapability`)
  })

  it('renders Markdown links as visible labels without terminal hyperlinks or destinations', () => {
    const stream = new ChatMarkdownStream(true)
    expect(stream.push('[Sim](https://sim.ai/work')).toBe('')
    expect(stream.push('space)')).toBe('Sim')

    const misleading = new ChatMarkdownStream(true)
    const misleadingOutput = misleading.push('[notexample.com](https://example.com/)')
    expect(misleadingOutput).toBe('notexample.com')

    const unsafe = new ChatMarkdownStream(true)
    const unsafeOutput = unsafe.push('[bad](javascript:alert(1))')
    expect(unsafeOutput).toBe('bad')

    const userInfo = new ChatMarkdownStream(true)
    const userInfoOutput = userInfo.push('[login](https://trusted.example@evil.example/)')
    expect(userInfoOutput).toBe('login')
    expect(`${misleadingOutput}${unsafeOutput}${userInfoOutput}`).not.toContain(`${ESC}]8;;`)
  })

  it('never prefixes streamed list items with an undefined renderer value', () => {
    const stream = new ChatMarkdownStream(true)
    const output = `${stream.push('- ')}${stream.flushInline()}default-agent${stream.finish()}`

    expect(output).toContain('default-agent')
    expect(output).not.toContain('undefined')
  })

  it('bounds incomplete link candidates and does not hide multiline prose', () => {
    const longLabel = `[${'x'.repeat(300)}`
    const labelStream = new ChatMarkdownStream(true)
    expect(labelStream.push(longLabel)).toBe(longLabel)

    const longDestination = `[label](https://example.com/${'x'.repeat(2_100)}`
    const destinationStream = new ChatMarkdownStream(true)
    expect(destinationStream.push(longDestination)).toBe(longDestination)

    const multiline = new ChatMarkdownStream(true)
    expect(multiline.push('[not a link\nnext line')).toBe('[not a link\nnext line')
  })

  it('sanitizes model controls before applying renderer-owned terminal styling', () => {
    const stream = new ChatMarkdownStream(true)
    const output = stream.push(`**safe${ESC}]0;owned\u0007**`)
    expect(output).toContain('safe')
    expect(output).not.toContain('owned')
    expect(output).not.toContain(`${ESC}]0;`)
  })

  it('is a sanitized byte-preserving stream when terminal styling is disabled', () => {
    const stream = new ChatMarkdownStream(false)
    expect(stream.push('**plain**\n')).toBe('**plain**\n')
    expect(stream.finish()).toBe('')
  })
})
