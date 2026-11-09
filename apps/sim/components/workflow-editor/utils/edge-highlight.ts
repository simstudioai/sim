/**
 * Whether an edge is drawn highlighted.
 *
 * Three places need this answer and each reaches it from a different source —
 * the edge itself from the React Flow store, a card from the same store while
 * deciding which of its knobs to darken, and the canvas while assigning the
 * edge's z so a highlighted line is not crossed by an ordinary one. They have
 * to agree: a knob checking fewer conditions than the line leaves a dark line
 * running into a light knob, and a z checking fewer leaves the highlight cut in
 * half by whatever crosses it.
 *
 * They agreed by being copied, which is the arrangement that produced both of
 * those bugs. This is the one definition.
 */
export function isEdgeHighlighted(state: {
  /** Either endpoint is selected on the canvas. */
  isEndpointSelected?: boolean
  /** Either endpoint is the block open in the editor panel. */
  isConnectedToEditor?: boolean
  /** The edge itself is selected. */
  isEdgeSelected?: boolean
}): boolean {
  return Boolean(state.isEndpointSelected || state.isConnectedToEditor || state.isEdgeSelected)
}

/**
 * Whether an edge touches the block currently open in the editor panel.
 *
 * `null` while the panel is on another tab, so a block left open behind the
 * console does not keep its edges lit.
 */
export function isEdgeConnectedToEditor(
  editorOpenBlockId: string | null,
  source: string,
  target: string
): boolean {
  return (
    editorOpenBlockId !== null && (source === editorOpenBlockId || target === editorOpenBlockId)
  )
}
