/**
 * @vitest-environment jsdom
 *
 * The `@`-mention is stored as a portable `[label](sim:<kind>/<id>)` markdown link but parses into a
 * dedicated `mention` node (rendered live as a chip). These guard that the parse → node → serialize
 * cycle is lossless, so the chat-portable wire format and the chip rendering stay in sync.
 */
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { parseMarkdownToDoc, serializeMarkdownBody } from '../markdown-parse'

function findMention(node: JSONContent): JSONContent | null {
  if (node.type === 'mention') return node
  for (const child of node.content ?? []) {
    const found = findMention(child)
    if (found) return found
  }
  return null
}

describe('mention node round-trip', () => {
  it('parses a sim: link into a mention node with kind/id/label', () => {
    const doc = parseMarkdownToDoc('See [Airweave](sim:integration/airweave) here')
    const mention = findMention(doc)
    expect(mention).not.toBeNull()
    expect(mention?.attrs).toEqual({ kind: 'integration', id: 'airweave', label: 'Airweave' })
  })

  it('serializes a mention node back to the portable sim: link', () => {
    for (const input of [
      'See [Airweave](sim:integration/airweave) here',
      '[my-skill](sim:skill/abc-123)',
      'a [Spec.md](sim:file/xyz_789) b',
    ]) {
      expect(serializeMarkdownBody(input).trim()).toBe(input)
    }
  })

  it('round-trips a label containing brackets (e.g. a bracketed file name) as a chip', () => {
    const input = '[data\\[1\\].csv](sim:file/abc)'
    const doc = parseMarkdownToDoc(input)
    const mention = findMention(doc)
    expect(mention?.attrs).toEqual({ kind: 'file', id: 'abc', label: 'data[1].csv' })
    expect(serializeMarkdownBody(input).trim()).toBe(input)
  })

  it('leaves a normal http link as a link, not a mention', () => {
    const doc = parseMarkdownToDoc('[Sim](https://sim.ai)')
    expect(findMention(doc)).toBeNull()
  })
})
