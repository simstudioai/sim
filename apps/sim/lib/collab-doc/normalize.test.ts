/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { COLLAB_DOC_FIELD, stripEmptyTopLevelParagraphs } from './normalize'

/** Build a top-level element with the given tag and optional text content. */
function element(tag: string, text?: string): Y.XmlElement {
  const el = new Y.XmlElement(tag)
  if (text !== undefined) el.insert(0, [new Y.XmlText(text)])
  return el
}

/** Recursively concatenate the visible text of a Yjs XML node. */
function textOf(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return node.toString()
  if (node instanceof Y.XmlElement) {
    let text = ''
    for (let i = 0; i < node.length; i++) text += textOf(node.get(i))
    return text
  }
  return ''
}

/** The ordered list of top-level `[tag, text]` pairs currently in a doc's body fragment. */
function structure(doc: Y.Doc): Array<[string, string]> {
  const fragment = doc.getXmlFragment(COLLAB_DOC_FIELD)
  const out: Array<[string, string]> = []
  for (let i = 0; i < fragment.length; i++) {
    const node = fragment.get(i)
    out.push([node instanceof Y.XmlElement ? node.nodeName! : 'text', textOf(node)])
  }
  return out
}

describe('stripEmptyTopLevelParagraphs', () => {
  it('removes interior empty paragraphs while preserving content and order (production repro)', () => {
    // Mirrors the persisted snapshot for random_data.md: a description paragraph, TWO consecutive empty
    // paragraphs (the reported "two spaces"), then a bullet list, then another interior empty paragraph.
    const doc = new Y.Doc()
    const fragment = doc.getXmlFragment(COLLAB_DOC_FIELD)
    fragment.insert(0, [
      element('paragraph', 'A small collection of sample data.'),
      element('paragraph'),
      element('paragraph'),
      element('bulletList', 'list'),
      element('paragraph'),
      element('paragraph', 'trailing content'),
    ])

    expect(stripEmptyTopLevelParagraphs(doc)).toBe(true)
    expect(structure(doc)).toEqual([
      ['paragraph', 'A small collection of sample data.'],
      ['bulletList', 'list'],
      ['paragraph', 'trailing content'],
    ])
    doc.destroy()
  })

  it('is idempotent — a second pass finds nothing to remove', () => {
    const doc = new Y.Doc()
    doc
      .getXmlFragment(COLLAB_DOC_FIELD)
      .insert(0, [element('paragraph'), element('paragraph', 'body')])

    expect(stripEmptyTopLevelParagraphs(doc)).toBe(true)
    expect(stripEmptyTopLevelParagraphs(doc)).toBe(false)
    expect(structure(doc)).toEqual([['paragraph', 'body']])
    doc.destroy()
  })

  it('returns false and mutates nothing when there are no top-level empty paragraphs', () => {
    const doc = new Y.Doc()
    doc
      .getXmlFragment(COLLAB_DOC_FIELD)
      .insert(0, [element('heading', 'Title'), element('paragraph', 'body')])

    expect(stripEmptyTopLevelParagraphs(doc)).toBe(false)
    expect(structure(doc)).toEqual([
      ['heading', 'Title'],
      ['paragraph', 'body'],
    ])
    doc.destroy()
  })

  it('leaves an empty paragraph nested inside another block untouched (only top-level is stripped)', () => {
    const doc = new Y.Doc()
    const listItem = new Y.XmlElement('listItem')
    listItem.insert(0, [new Y.XmlElement('paragraph')]) // an empty paragraph BELOW the fragment root
    const list = new Y.XmlElement('bulletList')
    list.insert(0, [listItem])
    doc.getXmlFragment(COLLAB_DOC_FIELD).insert(0, [list])

    expect(stripEmptyTopLevelParagraphs(doc)).toBe(false)
    const nestedList = doc.getXmlFragment(COLLAB_DOC_FIELD).get(0) as Y.XmlElement
    const nestedItem = nestedList.get(0) as Y.XmlElement
    expect(nestedItem.get(0)).toBeInstanceOf(Y.XmlElement)
    expect((nestedItem.get(0) as Y.XmlElement).nodeName).toBe('paragraph')
    doc.destroy()
  })

  it('survives an encode/decode round-trip preserving CRDT ids and the config map (seed-repair path)', () => {
    const original = new Y.Doc()
    original
      .getXmlFragment(COLLAB_DOC_FIELD)
      .insert(0, [element('paragraph', 'kept'), element('paragraph')])
    original.getMap('config').set('initialContentLoaded', true)
    original.getMap('config').set('frontmatter', 'title: x')
    const before = Y.encodeStateAsUpdate(original)
    original.destroy()

    // Repair exactly as normalizeSeedUpdate does: apply → strip → re-encode.
    const repair = new Y.Doc()
    Y.applyUpdate(repair, before)
    expect(stripEmptyTopLevelParagraphs(repair)).toBe(true)
    const after = Y.encodeStateAsUpdate(repair)
    repair.destroy()

    const seeded = new Y.Doc()
    Y.applyUpdate(seeded, after)
    expect(structure(seeded)).toEqual([['paragraph', 'kept']])
    expect(seeded.getMap('config').get('initialContentLoaded')).toBe(true)
    expect(seeded.getMap('config').get('frontmatter')).toBe('title: x')
    seeded.destroy()
  })
})
