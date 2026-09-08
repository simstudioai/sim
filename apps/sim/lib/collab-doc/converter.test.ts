/**
 * @vitest-environment jsdom
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  applyMarkdownToYDoc,
  markdownToYDoc,
  yDocToFileMarkdown,
  yDocToMarkdown,
} from '@/lib/collab-doc/converter'
import { COLLAB_DOC_FIELD } from '@/lib/collab-doc/field'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  editorNormalForm,
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

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
  '[<img src="https://e.com/i.png" alt="" width="320" height="180">](https://e.com)',
]

beforeAll(() => {
  if (!document.elementFromPoint) document.elementFromPoint = () => null
})

/** The schema the collab converter builds its docs on — mirrors `markdownSchema()` in converter.ts. */
const markdownSchemaForTest = () => getSchema(createMarkdownContentExtensions())

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

  describe('Markdown-derived seed and placeholder parity', () => {
    const shapeOf = (blocks: JSONContent[] | undefined) =>
      (blocks ?? [])
        .map((n) => (n.type === 'paragraph' && !n.content?.length ? '∅' : n.type))
        .join(',')

    /**
     * The doc a peer renders (the CRDT) vs the doc the placeholder builds from the projected markdown.
     * The placeholder is a real editor, so it is compared through {@link editorNormalForm} — the same
     * normalization ProseMirror applies on mount. Comparing the bare parse instead would assert a shape
     * neither side ever renders, and would let the CRDT drift back out of the editor's normal form.
     */
    const parity = (live: Y.Doc) => ({
      crdt: shapeOf(yDocToProsemirrorJSON(live, COLLAB_DOC_FIELD).content),
      placeholder: shapeOf(editorNormalForm(yDocToMarkdown(live)).content),
    })

    const paragraphs = (count: number) =>
      Array.from({ length: count }, () => new Y.XmlElement('paragraph'))

    /** Seed a doc from markdown, then apply an edit no markdown parse could have produced. */
    const typedInto = (md: string, edit: (fragment: Y.XmlFragment) => void) => {
      const live = markdownToYDoc(md)
      edit(live.getXmlFragment(COLLAB_DOC_FIELD))
      return live
    }

    it('a blank line typed between two paragraphs round-trips as-is', () => {
      const live = typedInto('a\n\nb', (f) => f.insert(1, paragraphs(2)))
      const { crdt, placeholder } = parity(live)
      expect(crdt).toBe('paragraph,∅,∅,paragraph')
      expect(placeholder).toBe(crdt)
      live.destroy()
    })

    it('holds for every representative document', () => {
      for (const md of [
        ...SAMPLES,
        'a\n\n\n\nb',
        '# Heading\n\n\n\nbody\n\n\n\n\n\ntail',
        '\n\n\n\nleading blank lines',
        '- a\n- b\n\n\n\nafter the list',
        '- a\n\n\n\n- b',
        '> a\n\n\n\n> b',
      ]) {
        const live = markdownToYDoc(md)
        const { crdt, placeholder } = parity(live)
        expect(placeholder, `diverged for ${JSON.stringify(md)}`).toBe(crdt)
        live.destroy()
      }
    })

    /**
     * Opening a document must not CHANGE it. ProseMirror appends an empty paragraph to any doc that
     * does not end in one, so a seed ending on a list, heading, table, or rule used to be rewritten by
     * the first client that bound to it — into the SHARED doc, where a trailing blank line cannot
     * serialize, so the file never recorded it and nothing ever reconciled the two. Every client that
     * seeded without seeing another's contribution stacked one more; a real document accumulated 18
     * against the placeholder's 1, and the pane jumped by that much the moment the live editor took
     * over. Seeding in the editor's own normal form is what makes the bind a no-op.
     */
    it.each([
      ['ends with a list', '# T\n\nbody\n\n- a\n- b'],
      ['ends with a heading', '# T\n\nbody\n\n## Tail'],
      ['ends with a table', '# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'],
      ['ends with a rule', '# T\n\nbody\n\n---'],
      ['ends with a paragraph', '# T\n\nbody'],
      ['ends with a blank line', '# T\n\nbody\n\n\n\n'],
    ])('binding an editor to the seed changes nothing: %s', (_label, md) => {
      const doc = markdownToYDoc(md)
      const before = doc.getXmlFragment(COLLAB_DOC_FIELD).length
      const awareness = new Awareness(doc)
      const editor = new Editor({
        extensions: createMarkdownEditorExtensions({
          placeholder: '',
          embeds: true,
          collaboration: {
            doc,
            awareness,
            user: { name: 'U', color: '#fff', clientId: doc.clientID },
          },
        }),
      })

      expect(doc.getXmlFragment(COLLAB_DOC_FIELD).length).toBe(before)

      editor.destroy()
      awareness.destroy()
      doc.destroy()
    })
  })

  describe('equivalent external bodies preserve native Yjs history', () => {
    it.each([
      ['trailing newlines', 'base', 'base\n\n'],
      ['alternate emphasis syntax', '**base**', '__base__'],
      ['alternate bullet marker', '- first\n- second', '* first\n* second'],
      ['CRLF line endings', 'first\n\nsecond', 'first\r\n\r\nsecond'],
    ])('retains a delayed edit into an empty tail with %s', (_label, body, equivalentBody) => {
      const server = markdownToYDoc(body)
      const tail = new Y.XmlElement('paragraph')
      tail.insert(0, [new Y.XmlText()])
      const fragment = server.getXmlFragment(COLLAB_DOC_FIELD)
      fragment.push([tail])
      const remote = new Y.Doc()
      const before = Y.encodeStateAsUpdate(server)
      Y.applyUpdate(remote, before)

      applyMarkdownToYDoc(server, equivalentBody)

      expect(Y.encodeStateAsUpdate(server)).toEqual(before)
      expect(fragment.get(fragment.length - 1)).toBe(tail)
      const remoteFragment = remote.getXmlFragment(COLLAB_DOC_FIELD)
      const remoteTail = remoteFragment.get(remoteFragment.length - 1) as Y.XmlElement
      const remoteText = remoteTail.get(0) as Y.XmlText
      remoteText.insert(0, 'late offline text')
      Y.applyUpdate(server, Y.encodeStateAsUpdate(remote))
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(server))

      expect(yDocToFileMarkdown(server)).toContain('late offline text')
      expect(yDocToFileMarkdown(remote)).toBe(yDocToFileMarkdown(server))
      remote.destroy()
      server.destroy()
    })

    it('updates frontmatter without deleting a delayed body edit target', () => {
      const server = markdownToYDoc('base')
      const tail = new Y.XmlElement('paragraph')
      tail.insert(0, [new Y.XmlText()])
      server.getXmlFragment(COLLAB_DOC_FIELD).push([tail])
      const remote = new Y.Doc()
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(server))
      const { frontmatter, body } = splitFrontmatter('---\ntitle: changed\n---\n\nbase')

      applyMarkdownToYDoc(server, body)
      server.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.frontmatterKey, frontmatter)
      const remoteTail = remote.getXmlFragment(COLLAB_DOC_FIELD).get(1) as Y.XmlElement
      const remoteText = remoteTail.get(0) as Y.XmlText
      remoteText.insert(0, 'late offline text')
      Y.applyUpdate(server, Y.encodeStateAsUpdate(remote))
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(server))

      expect(yDocToFileMarkdown(server)).toContain('title: changed')
      expect(yDocToFileMarkdown(server)).toContain('late offline text')
      expect(yDocToFileMarkdown(remote)).toBe(yDocToFileMarkdown(server))
      remote.destroy()
      server.destroy()
    })

    it('does not generate repeated repair identities for a legacy heading snapshot', () => {
      const doc = prosemirrorJSONToYDoc(
        markdownSchemaForTest(),
        parseMarkdownToDoc('# Heading'),
        COLLAB_DOC_FIELD
      )
      const before = Y.encodeStateAsUpdate(doc)

      for (let attempt = 0; attempt < 12; attempt++) {
        applyMarkdownToYDoc(doc, '# Heading')
      }

      expect(doc.getXmlFragment(COLLAB_DOC_FIELD).length).toBe(1)
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
      doc.destroy()
    })

    it.each([
      ['plain text', 'base', 'changed'],
      ['adding a paragraph', 'base', 'base\n\nnew paragraph'],
      ['deleting a paragraph', 'base\n\nremoved', 'base'],
      ['inline formatting', 'base', '**base**'],
      ['link destination', '[base](https://a.test)', '[base](https://b.test)'],
      ['list depth', '- first\n- second', '- first\n  - second'],
      ['task state', '- [ ] task', '- [x] task'],
      ['code whitespace', '```\na\n\nb\n```', '```\na\nb\n```'],
      ['code language', '```js\nx\n```', '```ts\nx\n```'],
      ['image source', '![alt](https://a.test/a.png)', '![alt](https://a.test/b.png)'],
      ['clearing the body', 'base', ''],
    ])('still applies actual changes to %s', (_label, beforeBody, afterBody) => {
      const doc = markdownToYDoc(beforeBody)
      const before = yDocToMarkdown(doc)

      applyMarkdownToYDoc(doc, afterBody)

      expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody(afterBody))
      expect(yDocToMarkdown(doc)).not.toBe(before)
      doc.destroy()
    })
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

  it('yDocToFileMarkdown matches the client save composition (frontmatter + postProcess body pass)', () => {
    // A server-side persist must be byte-identical to the editor save — `applyFrontmatter(frontmatter,
    // postProcessSerializedMarkdown(body))` — or it drifts from a client save / the dirty-check baseline
    // and churns the blob. This guards against the postProcess pass being dropped from the server path.
    const frontmatter = '---\ntitle: Doc\n---\n'
    const doc = markdownToYDoc('- one\n- two\n\n> [!NOTE]\n> hi')
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.frontmatterKey, frontmatter)
    const expected = applyFrontmatter(
      frontmatter,
      postProcessSerializedMarkdown(yDocToMarkdown(doc))
    )
    expect(yDocToFileMarkdown(doc)).toBe(expected)
    doc.destroy()
  })

  it('yDocToFileMarkdown re-attaches empty frontmatter when the config map has none', () => {
    const doc = markdownToYDoc('plain body\n')
    expect(yDocToFileMarkdown(doc)).toBe(postProcessSerializedMarkdown(yDocToMarkdown(doc)))
    doc.destroy()
  })
})
