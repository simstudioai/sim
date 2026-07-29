import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { FootnoteDef, RawHtmlBlock } from './raw-markdown-snippet-schema'

const BLOCK_CONTROL_CLASS =
  'pointer-events-none absolute top-1.5 right-2 select-none rounded-md bg-[var(--surface-4)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wide opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'

/** Badge text per block node type name — kept here rather than threaded through node options since
 * {@link NodeViewProps} exposes no options/extension reference to the rendering component. */
const BLOCK_BADGE_LABEL: Record<string, string> = {
  rawHtmlBlock: 'Raw HTML',
  footnoteDef: 'Footnote',
}

function RawBlockView({ node }: ReactNodeViewProps) {
  const label = BLOCK_BADGE_LABEL[node.type.name] ?? 'Raw'
  return (
    <NodeViewWrapper className='group relative'>
      <span className={BLOCK_CONTROL_CLASS} contentEditable={false}>
        {label}
      </span>
      <div className='raw-markdown-block'>
        <NodeViewContent<'span'> as='span' />
      </div>
    </NodeViewWrapper>
  )
}

/** Live variant of {@link RawHtmlBlock} with a hover "Raw HTML" badge — same schema/serializer. */
export const RawHtmlBlockWithView = RawHtmlBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RawBlockView)
  },
})

/** Live variant of {@link FootnoteDef} with a hover "Footnote" badge — same schema/serializer. */
export const FootnoteDefWithView = FootnoteDef.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RawBlockView)
  },
})
