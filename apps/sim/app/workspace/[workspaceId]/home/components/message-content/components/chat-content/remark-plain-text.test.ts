import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { remarkPlainText } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/remark-plain-text'

const reference = unified().use(remarkParse).use(remarkGfm)
const optimized = unified().use(remarkParse).use(remarkGfm).use(remarkPlainText)

describe('plain-paragraph parsing', () => {
  it('matches remark positions, whitespace, and Unicode text', () => {
    for (const text of [
      'Hello world! ',
      'Hello  ',
      'A café, 日本語, العربية, 😀 and nonbreaking\u00a0spaces.\u00a0',
      'A sentence with (parentheses), quotes, 1.23 and 20% off.',
      '12)word',
      'Plain\u000btext\u000ctext',
    ]) {
      for (let end = 0; end <= text.length; end++) {
        const prefix = text.slice(0, end)
        expect(optimized.parse(prefix), JSON.stringify(prefix)).toEqual(reference.parse(prefix))
      }
    }
  })

  it('preserves Markdown interpretation when a plain prefix gains syntax', () => {
    const cases = [
      'Text **bold**, _italic_, ~~deleted~~ and `code`.',
      'Text [link](https://example.com), ![image](files/chart.png).',
      'Text www.example.com, https://example.com and user@example.com.',
      'Text WWW.EXAMPLE.COM and foo@bar.test.',
      'Text &amp; and &#x41; and <b>raw</b>.',
      'Text \\*escaped\\* and \\\nline break.',
      'Text  \nline break.\r\n\r\nNext paragraph.',
      'Text\u0000replacement\tand tab',
      '1. Ordered list\n2. Next item',
      '1) Ordered list',
      '   Indented text\n\n    code',
      '# Heading\n\n> Quote\n\n---\n\n- [x] task',
      'Heading\n=======\n\n| Table |\n| --- |\n| Cell |',
      '[link][ref]\n\n[ref]: https://example.com',
      '```typescript\nconst text = `multiline\nvalue`\n```',
      '\ufeffText',
    ]
    for (const text of cases) {
      for (let end = 0; end <= text.length; end++) {
        const prefix = text.slice(0, end)
        expect(optimized.parse(prefix), JSON.stringify(prefix)).toEqual(reference.parse(prefix))
      }
    }
  })

  it('matches the reference on growing paragraphs and every ASCII character', () => {
    const cases = [
      'A plain paragraph describing the workflow. '.repeat(50),
      '## Heading\n\nA paragraph.\n\n- A list item\n\n| Column |\n| --- |\n| Cell |\n\n'.repeat(30),
      `\`\`\`typescript\n${'const value = items.map((item) => item.value)\n'.repeat(40)}\`\`\``,
      'A citation. <source>{"url":"https://example.com"}</source>\n\n'.repeat(30),
    ]
    for (const text of cases) {
      for (let end = 7; end <= text.length; end += 7) {
        expect(optimized.parse(text.slice(0, end))).toEqual(reference.parse(text.slice(0, end)))
      }
    }
    for (let char = 0; char < 128; char++) {
      const text = `Before ${String.fromCharCode(char)} after `
      expect(optimized.parse(text), JSON.stringify(text)).toEqual(reference.parse(text))
    }
  })
})
