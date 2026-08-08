/**
 * @vitest-environment jsdom
 *
 * Regression guards for two bugs found while adding the `@` mention menu:
 *
 * 1. The `@` mention and `/` slash-command extensions each register a `@tiptap/suggestion` plugin.
 *    They must use distinct plugin keys, or constructing any editor with the full set throws
 *    "Adding different instances of a keyed plugin (suggestion$)".
 *
 * 2. A markdown file authored outside the editor (e.g. the former Monaco editor) is rarely in the
 *    editor's canonical serialization. On open, a deferred view-plugin transaction re-serializes the
 *    doc to canonical markdown and emits one update — which, compared against the raw saved bytes,
 *    falsely marks the file dirty ("unsaved changes"). The fix normalizes the dirty-check baseline to
 *    the canonical form; this asserts that normalized form equals what the live editor emits.
 */

import { sleep } from '@sim/utils/helpers'
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMarkdownEditorExtensions } from './editor-extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'
import { parseMarkdownToDoc } from './markdown-parse'
import { normalizeMarkdownContent } from './normalize-content'

let editor: Editor | null = null
let host: HTMLElement | null = null

beforeAll(() => {
  // jsdom lacks the layout APIs the Placeholder viewport plugin calls when a view mounts.
  // @ts-expect-error jsdom stub
  document.elementFromPoint = () => document.body
  // @ts-expect-error jsdom stub
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList
})

afterEach(() => {
  editor?.destroy()
  editor = null
  host?.remove()
  host = null
})

describe('full extension set', () => {
  it('mounts without a duplicate suggestion-plugin-key error (@ and / coexist)', () => {
    expect(() => {
      editor = new Editor({
        extensions: createMarkdownEditorExtensions({ placeholder: 'x' }),
        content: '',
      })
    }).not.toThrow()
  })
})

describe('normalizeMarkdownContent — dirty-on-open baseline', () => {
  it('normalizes non-canonical markdown to the editor canonical form', () => {
    expect(normalizeMarkdownContent('* one\n* two\n')).toBe('- one\n- two\n')
  })

  it('is idempotent', () => {
    for (const md of [
      '* one\n* two\n',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      '# H\n\nsome _emphasis_ here\n',
    ]) {
      const once = normalizeMarkdownContent(md)
      expect(normalizeMarkdownContent(once)).toBe(once)
    }
  })

  it('leaves round-trip-unsafe content untouched (read-only files keep their raw bytes)', () => {
    const unsafe = 'text with a footnote[^1]\n\n[^1]: the note\n'
    expect(normalizeMarkdownContent(unsafe)).toBe(unsafe)
  })
})

describe('baseline neutralizes the mount-time dirty signal', () => {
  it('the editor mount serialization equals the normalized baseline (so isDirty stays false)', async () => {
    const raw = '# H\n\n* bullet\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quote\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    host = document.createElement('div')
    document.body.appendChild(host)

    let emitted: string | null = null
    editor = new Editor({
      element: host,
      extensions: createMarkdownEditorExtensions({ placeholder: 'x' }),
      content: parseMarkdownToDoc(body),
      onUpdate: ({ editor }) => {
        emitted = applyFrontmatter(frontmatter, postProcessSerializedMarkdown(editor.getMarkdown()))
      },
    })

    await sleep(30)

    // The deferred mount transaction re-serializes to canonical markdown; the baseline must match it
    // exactly, so `content === savedContent` and the file is never falsely dirty on open.
    expect(emitted).not.toBeNull()
    expect(emitted).toBe(normalizeMarkdownContent(raw))
  })
})
