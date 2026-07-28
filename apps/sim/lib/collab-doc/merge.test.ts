/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { serializeMarkdownBody } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { markdownToYDoc, yDocToMarkdown } from './converter'
import { buildFileDocMergeUpdate } from './merge'

describe('buildFileDocMergeUpdate', () => {
  it('produces a diff that turns the live doc into the target markdown', () => {
    const live = markdownToYDoc('# Title\n\nOriginal.')
    const update = buildFileDocMergeUpdate(Y.encodeStateAsUpdate(live), '# Title\n\nRewritten.')
    Y.applyUpdate(live, update)
    expect(yDocToMarkdown(live)).toBe(serializeMarkdownBody('# Title\n\nRewritten.'))
  })

  it('strips frontmatter — merges only the body, never the YAML', () => {
    const live = markdownToYDoc('# Title\n\nBody.')
    const update = buildFileDocMergeUpdate(
      Y.encodeStateAsUpdate(live),
      '---\ntitle: X\n---\n\n# Title\n\nBody rewritten.'
    )
    Y.applyUpdate(live, update)
    const md = yDocToMarkdown(live)
    expect(md).not.toContain('title: X')
    expect(md).toBe(serializeMarkdownBody('# Title\n\nBody rewritten.'))
  })

  it('returns an empty (no-op) diff when the markdown already matches', () => {
    const live = markdownToYDoc('# Same\n\nBody.')
    const before = Y.encodeStateVector(live)
    const update = buildFileDocMergeUpdate(Y.encodeStateAsUpdate(live), yDocToMarkdown(live))
    Y.applyUpdate(live, update)
    // Nothing new was introduced: the doc's state vector is unchanged by applying the diff.
    expect(Y.encodeStateVector(live)).toEqual(before)
  })

  it('merges a copilot rewrite with a concurrent remote edit (no clobber)', () => {
    // The relay captures the live doc's state and asks the app for the diff…
    const live = markdownToYDoc('# Doc\n\nAlpha paragraph.\n\nBeta paragraph.')
    const capturedState = Y.encodeStateAsUpdate(live)

    // …meanwhile a remote user edits the FIRST paragraph directly on the live doc, AFTER the capture.
    const frag = live.getXmlFragment('default')
    live.transact(() => {
      const firstPara = frag.get(1) as Y.XmlElement
      const textNode = firstPara.get(0) as Y.XmlText
      textNode.insert(textNode.toString().length, ' EDITED')
    })

    // Copilot rewrites the SECOND paragraph; the diff is computed against the CAPTURED (older) state.
    const update = buildFileDocMergeUpdate(
      capturedState,
      '# Doc\n\nAlpha paragraph.\n\nBeta paragraph, expanded by the agent.'
    )
    // Applying the diff to the now-advanced live doc must preserve BOTH edits.
    Y.applyUpdate(live, update)

    const merged = yDocToMarkdown(live)
    expect(merged).toContain('Alpha paragraph. EDITED')
    expect(merged).toContain('expanded by the agent')
  })
})
