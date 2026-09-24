/** @vitest-environment jsdom */
import { act } from 'react'
import Prism from 'prismjs'
import { createRoot } from 'react-dom/client'
import 'prismjs/components/prism-typescript'
import { describe, expect, it } from 'vitest'
import {
  HighlightedLines,
  splitHighlightedLines,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/highlighted-lines'

/** Compare per-character token ancestry, ignoring unstyled line wrappers. */
function styledCharacters(element: Element): Array<[string, string]> {
  const result: Array<[string, string]> = []
  function visit(node: Node, classes: string[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const char of node.textContent ?? '') {
        if (char !== '\n') result.push([char, classes.join('/')])
      }
    } else if (node instanceof Element) {
      const nextClasses = node.className ? [...classes, node.className] : classes
      for (const child of node.childNodes) visit(child, nextClasses)
    }
  }
  visit(element, [])
  return result
}

describe('highlighted code lines', () => {
  it('preserves full-fence Prism text and token styles across multiline constructs', () => {
    const cases = [
      `const value = \`first\nsecond \${1 + 2}\nthird\`\n`,
      '/* a comment\nwith <script>alert(1)</script>\n*/\nconst x = "safe"',
      '<div title="a &amp; b">\n  <!-- multi\n  line -->\n</div>',
      'const x = "<img src=x onerror=alert(1)>"\n\nconst y = 1',
    ]
    for (const code of cases) {
      for (let end = 1; end <= code.length; end++) {
        const prefix = code.slice(0, end)
        for (const language of ['typescript', 'markup']) {
          const html = Prism.highlight(prefix, Prism.languages[language], language)
          const before = document.createElement('pre')
          before.innerHTML = html
          const after = document.createElement('pre')
          for (const line of splitHighlightedLines(html)) {
            const span = document.createElement('span')
            span.innerHTML = line
            after.appendChild(span)
          }
          expect(after.textContent).toBe(before.textContent)
          expect(styledCharacters(after)).toEqual(styledCharacters(before))
          expect(after.querySelector('script, img')).toBeNull()
        }
      }
    }
  })

  it('retains unchanged token nodes and updates earlier lines when grammar changes', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('pre')
    const root = createRoot(container)
    const render = (code: string) =>
      act(async () => {
        root.render(
          <HighlightedLines
            html={Prism.highlight(code, Prism.languages.typescript, 'typescript')}
          />
        )
      })
    try {
      await render('const first = 1\nconst second = 2')
      const firstToken = container.querySelector('.token.keyword')
      await render('const first = 1\nconst second = 234\nconst third = 3')
      expect(container.querySelector('.token.keyword')).toBe(firstToken)
      await render('/* first line\nsecond line')
      await render('/* first line\nsecond line */\nconst end = 3')
      expect(container.querySelector('.token.comment')?.textContent).toBe('/* first line')
      expect(container.textContent).toBe('/* first line\nsecond line */\nconst end = 3')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
