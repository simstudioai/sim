/**
 * @vitest-environment jsdom
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
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
import {
  applyMarkdownToYDoc,
  canonicalizeYDoc,
  markdownToYDoc,
  yDocToFileMarkdown,
  yDocToMarkdown,
} from './converter'
import { COLLAB_DOC_FIELD } from './field'

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

  /**
   * The Files editor paints a read-only placeholder built from the file's markdown, then swaps in the
   * live collaborative doc once the CRDT syncs. Anything the CRDT holds that the markdown projection
   * cannot round-trip shows up as the document reflowing its spacing a beat after the file appears.
   *
   * The case that matters is a state no markdown parse produced: the user presses Enter on an empty
   * line, which puts a real empty paragraph in the CRDT. Projecting that to markdown and re-parsing it
   * has to give the same blocks back — otherwise the blank line is both invisible on first paint and
   * deleted for good once the room goes cold.
   */
  describe('placeholder ⇄ live CRDT parity', () => {
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

    /**
     * Every CRDT state below is one markdown genuinely cannot describe, so the round-trip is NOT the
     * identity on it — a run past the parse bound, trailing empties the serializer collapses, an empty
     * paragraph in a document that must parse whole. Each one used to reach a room verbatim and reflow
     * the doc a beat after it painted. `canonicalizeYDoc` is the single pass that resolves all of them,
     * so assert the invariant it establishes rather than enumerating what markdown can hold.
     */
    it.each([
      [
        'a run past the per-gap bound',
        () => typedInto('a\n\nb', (f) => f.insert(1, paragraphs(30))),
      ],
      ['trailing empties', () => typedInto('a\n\nb', (f) => f.insert(f.length, paragraphs(3)))],
      ['leading empties', () => typedInto('a\n\nb', (f) => f.insert(0, paragraphs(2)))],
      ['between two lists', () => typedInto('- a\n\n- b', (f) => f.insert(1, paragraphs(1)))],
      ['between two quotes', () => typedInto('> a\n\n> b', (f) => f.insert(1, paragraphs(1)))],
      [
        'inside a raw-HTML document',
        () => typedInto('# H\n\nbody\n\n<div>x</div>', (f) => f.insert(1, paragraphs(1))),
      ],
      [
        'inside a reference-definition document',
        () =>
          typedInto('# H\n\nsee [y][r]\n\n[r]: https://e.com', (f) => f.insert(1, paragraphs(1))),
      ],
    ])('canonicalizing restores parity: %s', (_label, build) => {
      const live = build()
      canonicalizeYDoc(live)
      const { crdt, placeholder } = parity(live)
      expect(placeholder).toBe(crdt)
      // Idempotent: a canonical doc is already its own markdown projection, so a second pass is a no-op.
      expect(canonicalizeYDoc(live)).toBe(false)
      live.destroy()
    })

    /**
     * The point of canonical is that the CRDT and the durable bytes describe the same document, so the
     * invariant is stated against the bytes that get WRITTEN — `yDocToFileMarkdown`, post-process and
     * all. Converging on the bare serializer output instead would leave that pass's fidelity fixes
     * (empty list markers, escaped callout markers) outside the fixed point.
     */
    it.each([
      ['a callout the serializer escapes', '# T\n\n> [!NOTE]\n> body\n\ntail'],
      ['a list with an empty item', '# T\n\n- parent\n  - \n- after'],
      ['trailing blank run', '# T\n\nbody\n\n\n\n'],
      ['ends on a list', '# T\n\nintro\n\n- a\n- b'],
    ])('a canonical doc projects to exactly the file body: %s', (_label, md) => {
      const live = markdownToYDoc(md)
      canonicalizeYDoc(live)

      const body = splitFrontmatter(yDocToFileMarkdown(live)).body
      // Re-reading the written bytes must rebuild the very doc the CRDT holds.
      expect(shapeOf(editorNormalForm(body).content)).toBe(
        shapeOf(yDocToProsemirrorJSON(live, COLLAB_DOC_FIELD).content)
      )
      // And a second pass has nothing left to do.
      expect(canonicalizeYDoc(live)).toBe(false)
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
     * `canonicalizeYDoc`'s return value gates whether both callers re-encode, so it has to be true
     * whenever the doc actually moved. Deciding that from the markdown projection could not work: the
     * repair is the trailing paragraph, which serializes to a blank line the post-process collapses, so
     * every doc ending on a list/heading/table/rule was repaired and still reported unchanged — and the
     * cached snapshot kept the unrepaired bytes, reopening the stacking-empties path.
     */
    it.each([
      ['ends with a list', '# T\n\nbody\n\n- a\n- b'],
      ['ends with a heading', '# T\n\nbody\n\n## Tail'],
      ['ends with a table', '# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'],
      ['ends with a rule', '# T\n\nbody\n\n---'],
    ])('reports the repair it actually made: %s', (_label, md) => {
      // A doc built from the RAW parse — what a snapshot cached before this normalization looks like.
      const doc = prosemirrorJSONToYDoc(
        markdownSchemaForTest(),
        parseMarkdownToDoc(md),
        COLLAB_DOC_FIELD
      )
      const before = shapeOf(yDocToProsemirrorJSON(doc, COLLAB_DOC_FIELD).content)

      const reported = canonicalizeYDoc(doc)

      const after = shapeOf(yDocToProsemirrorJSON(doc, COLLAB_DOC_FIELD).content)
      expect(after).toBe(`${before},∅`)
      expect(reported).toBe(true)
      doc.destroy()
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
