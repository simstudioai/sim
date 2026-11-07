/** The fields normalization reads, shared by a chat context before and after parsing. */
interface NormalizableContext {
  kind: string
  currentView?: { viewId?: string | null } | null
  viewId?: string | null
  blockId?: string
  blockIds?: string[]
}

/**
 * A message's contexts in the shape context processing reads: a table names the
 * view it was sent from, and a block selection always lists its block ids. A turn
 * and a steering message share it, so the same mention resolves the same way.
 */
export function normalizeContexts<C extends NormalizableContext>(
  contexts: C[] | undefined
): C[] | undefined {
  if (!Array.isArray(contexts)) {
    return contexts
  }

  return contexts.map((ctx) => {
    if (ctx.kind === 'table' && ctx.currentView)
      return { ...ctx, viewId: ctx.currentView.viewId ?? undefined }
    if (ctx.kind !== 'blocks') return ctx
    if (Array.isArray(ctx.blockIds) && ctx.blockIds.length > 0) return ctx
    if (ctx.blockId) return { ...ctx, blockIds: [ctx.blockId] }
    return ctx
  })
}
