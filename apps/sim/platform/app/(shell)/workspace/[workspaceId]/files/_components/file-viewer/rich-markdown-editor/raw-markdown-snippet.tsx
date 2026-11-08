'use client'

import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/node-views.module.css'
import { FootnoteDef, RawHtmlBlock } from '@/platform/lib/data/files/markdown'

const BLOCK_BADGE_LABEL: Record<string, string> = {
  rawHtmlBlock: 'Raw HTML',
  footnoteDef: 'Footnote',
}

/** Markdown held verbatim: its badge says the editor does not interpret it. */
function RawBlockView({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper>
      <div className={styles.rawBlock}>
        <span className={styles.rawBadge} data-type='T052' contentEditable={false}>
          {BLOCK_BADGE_LABEL[node.type.name] ?? 'Raw'}
        </span>
        <div className={styles.rawSource}>
          <NodeViewContent<'span'> as='span' />
        </div>
      </div>
    </NodeViewWrapper>
  )
}

/** Raw HTML with its badge; the same schema and serializer as the headless node. */
export const RawHtmlBlockWithView = RawHtmlBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RawBlockView)
  },
})

/** A footnote definition with its badge; the same schema and serializer as the headless node. */
export const FootnoteDefWithView = FootnoteDef.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RawBlockView)
  },
})
