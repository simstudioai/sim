/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { serializeMarkdownBody } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { applyMarkdownToYDoc, markdownToYDoc, yDocToMarkdown } from './converter'

/** Representative markdown covering the custom-fidelity constructs (tables, code, lists, marks). */
const SAMPLES = [
  '# Title\n\nA paragraph with **bold**, *italic*, and `code`.',
  '- one\n- two\n  - nested\n\n1. first\n2. second',
  '> a quote\n\n```ts\nconst x = 1\n```',
  '| a | b |\n| --- | --- |\n| 1 | 2 |\n| pipe \\| here | y |',
  'Text with a [link](https://example.com) and a break.\n\nSecond paragraph.',
  // Custom-fidelity constructs — the exact cases a second markdown engine would diverge on, and
  // that only survive because the server reuses the client's own @tiptap/markdown engine.
  'A footnote reference[^1].\n\n[^1]: the footnote body.',
  'Before.\n\n<div class="raw">untouched raw html</div>\n\nAfter.',
  '- [ ] todo\n- [x] done',
]

describe('collab-doc converter', () => {
  it('round-trips markdown through the Yjs doc identically to the client engine', () => {
    for (const md of SAMPLES) {
      // yDocToMarkdown(markdownToYDoc(md)) must equal the client's own canonical serialization —
      // both go through the exact same @tiptap/markdown engine, so the Yjs hop must be lossless.
      expect(yDocToMarkdown(markdownToYDoc(md))).toBe(serializeMarkdownBody(md))
    }
  })

  it('projects an empty doc without throwing', () => {
    expect(yDocToMarkdown(markdownToYDoc(''))).toBe(serializeMarkdownBody(''))
  })

  it('applies new content into an existing doc (agent write)', () => {
    const ydoc = markdownToYDoc('# Hello\n\nWorld.')
    applyMarkdownToYDoc(ydoc, '# Hello\n\nWorld and then some more.')
    expect(yDocToMarkdown(ydoc)).toBe(serializeMarkdownBody('# Hello\n\nWorld and then some more.'))
  })

  it('clears an existing doc to empty without throwing (agent write of empty content)', () => {
    const ydoc = markdownToYDoc('# Hello\n\nWorld.')
    expect(() => applyMarkdownToYDoc(ydoc, '')).not.toThrow()
    expect(yDocToMarkdown(ydoc)).toBe(serializeMarkdownBody(''))
  })

  it('merges an agent write with a concurrent remote edit (CRDT, no clobber)', () => {
    // Two clients start from the same state.
    const server = markdownToYDoc('# Doc\n\nAlpha paragraph.\n\nBeta paragraph.')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(server))

    // The remote user edits the FIRST paragraph's text directly on the shared type, concurrently…
    const remoteFrag = remote.getXmlFragment('default')
    remote.transact(() => {
      // second child (index 1) is the first paragraph; append " EDITED" to its text node.
      const firstPara = remoteFrag.get(1) as Y.XmlElement
      const textNode = firstPara.get(0) as Y.XmlText
      textNode.insert(textNode.toString().length, ' EDITED')
    })

    // …while the agent rewrites the SECOND paragraph via the converter on the server doc.
    applyMarkdownToYDoc(
      server,
      '# Doc\n\nAlpha paragraph.\n\nBeta paragraph, expanded by the agent.'
    )

    // Exchange updates both ways (as the relay would) and both edits must survive the merge.
    Y.applyUpdate(server, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(server)))
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(server, Y.encodeStateVector(remote)))

    const merged = yDocToMarkdown(server)
    expect(merged).toContain('Alpha paragraph. EDITED')
    expect(merged).toContain('expanded by the agent')
  })
})
