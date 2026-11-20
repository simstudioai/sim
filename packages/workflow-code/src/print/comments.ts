/**
 * Comments at anchors. Comments live in
 * `annotations.comments` keyed by anchor; the printer places each one at its anchor, moves one
 * whose param or wiring statement no longer prints to its block, and drops one whose block is gone.
 */

import { decodeAnchor, encodeAnchor } from '../anchors'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import { diagnostic } from '../diagnostics/factory'
import { type Diagnostic, splitLines } from '../diagnostics/frame'
import type { AnchorKey, BlockKey, CodeComment, PortKey } from '../model'
import { breakParent, type Doc, hardline, join, lineSuffix, literalText } from './doc'

export const anchors = {
  header: encodeAnchor({ kind: 'header' }),
  wiring: encodeAnchor({ kind: 'wiring' }),
  footer: encodeAnchor({ kind: 'footer' }),
  block: (block: BlockKey) => encodeAnchor({ kind: 'block', block }),
  param: (block: BlockKey, param: string) => encodeAnchor({ kind: 'param', block, param }),
  edges: (block: BlockKey, port: PortKey) => encodeAnchor({ kind: 'edges', block, port }),
  variable: (variable: string) => encodeAnchor({ kind: 'var', variable }),
}

/** The block an anchor belongs to, or `null` for file-level and variable anchors. */
function anchorBlock(anchor: string): BlockKey | null {
  const decoded = decodeAnchor(anchor)
  if (!decoded) return null
  return 'block' in decoded ? decoded.block : null
}

function printComment(comment: CodeComment): Doc {
  if (comment.kind === 'line' || comment.text.includes('*/')) {
    return join(
      hardline,
      splitLines(comment.text).map((text) => `//${text}`)
    )
  }
  const lines = comment.text.split('\n')
  const indentable =
    lines.length > 1 && lines.slice(1).every((text) => text.trimStart().startsWith('*'))
  if (!indentable) return ['/*', literalText(comment.text), '*/']
  const body = lines.map((text, index) => {
    if (index === 0) return text.trimEnd()
    return ` ${index < lines.length - 1 ? text.trim() : text.trimStart()}`
  })
  return ['/*', join(hardline, body), '*/']
}

export interface AttachedComments {
  leading: Doc[]
  trailing: Doc[]
}

/** Hands out each anchor's comments once and reports the ones nobody claimed. */
export class CommentPlacer {
  private readonly pending = new Map<string, CodeComment[]>()
  /** Each block's param and wiring anchors, in `pending` order, so orphans are found per block. */
  private readonly orphanAnchors = new Map<BlockKey, string[]>()
  readonly diagnostics: Diagnostic<PrintDiagnosticCode>[] = []

  constructor(comments: Partial<Record<AnchorKey, CodeComment[]>>) {
    for (const [anchor, list] of Object.entries(comments)) {
      if (!list || list.length === 0) continue
      this.pending.set(anchor, [...list])
      const decoded = decodeAnchor(anchor)
      if (!decoded || decoded.kind === 'block' || !('block' in decoded)) continue
      const anchorsOfBlock = this.orphanAnchors.get(decoded.block) ?? []
      anchorsOfBlock.push(anchor)
      this.orphanAnchors.set(decoded.block, anchorsOfBlock)
    }
  }

  take(anchor: AnchorKey): AttachedComments {
    const list = this.pending.get(anchor) ?? []
    this.pending.delete(anchor)
    return split(list)
  }

  /**
   * Claims every comment left on a param or wiring anchor of `block` so it prints with the block
   * declaration (`W_COMMENT_MOVED`). Call after the block's params and wiring were printed.
   */
  takeOrphans(block: BlockKey): AttachedComments {
    const moved: CodeComment[] = []
    for (const anchor of this.orphanAnchors.get(block) ?? []) {
      const list = this.pending.get(anchor)
      if (!list) continue
      this.pending.delete(anchor)
      moved.push(...list)
      this.diagnostics.push(
        diagnostic(
          'W_COMMENT_MOVED',
          'A comment has no printed anchor; moved to its block declaration.',
          {
            blockKey: block,
          }
        )
      )
    }
    return split(moved)
  }

  /** Reports every comment no anchor claimed (`W_COMMENT_DROPPED`). */
  dropRemaining(): void {
    for (const anchor of this.pending.keys()) {
      const block = anchorBlock(anchor)
      this.diagnostics.push(
        diagnostic('W_COMMENT_DROPPED', 'A comment was dropped: its anchor no longer exists.', {
          ...(block === null ? {} : { blockKey: block }),
        })
      )
    }
    this.pending.clear()
  }
}

function split(list: CodeComment[]): AttachedComments {
  const leading: Doc[] = []
  const trailing: Doc[] = []
  for (const comment of list) {
    if (comment.placement === 'leading') {
      leading.push(printComment(comment))
    } else if (comment.kind === 'line') {
      trailing.push([lineSuffix([' ', printComment(comment)]), breakParent])
    } else {
      trailing.push([' ', printComment(comment)])
    }
  }
  return { leading, trailing }
}

/** A statement with its leading comments above and trailing comments after. */
export function withComments(statement: Doc, comments: AttachedComments): Doc {
  return [...comments.leading.map((comment) => [comment, hardline]), statement, comments.trailing]
}
