import type { Comment } from '@babel/types'
import { encodeAnchor } from '../anchors'
import type { AnchorKey, CodeComment } from '../model'
import { getOwn, setOwn } from '../records'
import type { Reporter } from './report'

/** One anchorable node in a sibling list: a statement, a param property, a variable. */
interface AnchorItem {
  start: number
  end: number
  startLine: number
  endLine: number
  /** `null` falls back to the list's owner. */
  anchor: AnchorKey | null
  /** The first wiring statement of the workflow body, for the `wiring` anchor. */
  firstWiring: boolean
}

type TailRule = { anchor: AnchorKey; placement: CodeComment['placement'] } | 'last-item'

interface SiblingList {
  start: number
  end: number
  items: AnchorItem[]
  /** Where a comment goes when the list has no items to attach to. */
  owner: AnchorKey
  /** Where a comment after the last item, on its own line, goes. */
  tail: TailRule
}

export type AddCommentItem = (
  node: { start?: number | null; end?: number | null },
  anchor: AnchorKey | null,
  firstWiring?: boolean
) => void

export interface ListOptions {
  owner: AnchorKey
  tail: TailRule
}

/**
 * Assigns every comment to an anchor. The interpreter
 * registers each sibling list it walks (module statements, a body's statements, a params object's
 * properties, the variables object) with an anchor per item. A comment between items attaches to
 * the previous item when it ends on the same line (trailing), else to the next (leading), else to
 * the list's tail. A comment inside an item is hoisted to that item's anchor with
 * `W_COMMENT_MOVED`, so after one print every comment sits at an anchor.
 *
 * Two extra rules: the comment group directly above the first wiring statement goes to `wiring`
 * when a blank line separates it from that statement, and everything before the first import goes
 * to `header`.
 */
export class CommentCollector {
  private readonly lists: SiblingList[] = []
  readonly comments: Partial<Record<AnchorKey, CodeComment[]>> = {}

  constructor(
    private readonly file: string,
    private readonly reporter: Reporter
  ) {}

  private line(offset: number): number {
    return this.reporter.span({ file: this.file, start: offset, end: offset }).line
  }

  /** Starts a sibling list covering `[start, end)`; returns a function that adds items to it. */
  list(start: number, end: number, options: ListOptions): AddCommentItem {
    const list: SiblingList = { start, end, items: [], ...options }
    this.lists.push(list)
    return (node, anchor, firstWiring = false) => {
      const itemStart = node.start ?? start
      const itemEnd = node.end ?? itemStart
      list.items.push({
        start: itemStart,
        end: itemEnd,
        startLine: this.line(itemStart),
        endLine: this.line(itemEnd),
        anchor,
        firstWiring,
      })
    }
  }

  private add(anchor: AnchorKey, comment: Comment, placement: CodeComment['placement']): void {
    const entry: CodeComment = {
      text: comment.value,
      kind: comment.type === 'CommentLine' ? 'line' : 'block',
      placement,
    }
    const existing = getOwn(this.comments, anchor)
    if (existing) existing.push(entry)
    else setOwn<CodeComment[] | undefined>(this.comments, anchor, [entry])
  }

  /** Assigns `comments` (in source order) once every list is registered. */
  assign(comments: readonly Comment[]): void {
    const footer = encodeAnchor({ kind: 'footer' })
    for (const list of this.lists) list.items.sort((a, b) => a.start - b.start)
    // Lists come from nested AST nodes, so they nest or are disjoint. Sweeping them in start order
    // (outer first; among equal spans the first registered on top) keeps a stack whose top is the
    // innermost list around the current comment.
    const order = this.lists
      .map((list, index) => ({ list, index }))
      .sort((a, b) => a.list.start - b.list.start || b.list.end - a.list.end || b.index - a.index)
    const open: SiblingList[] = []
    let nextList = 0
    for (const comment of comments) {
      const start = comment.start ?? 0
      const end = comment.end ?? start
      while (nextList < order.length && order[nextList].list.start <= start) {
        const entering = order[nextList].list
        while (open.length > 0 && open[open.length - 1].end < entering.start) open.pop()
        open.push(entering)
        nextList++
      }
      while (open.length > 0 && open[open.length - 1].end < end) open.pop()
      const list = open.length > 0 ? open[open.length - 1] : null
      if (!list) {
        this.add(footer, comment, 'leading')
        continue
      }
      const items = list.items
      const at = lastStartingAtOrBefore(items, start)
      const candidate = at === -1 ? undefined : items[at]
      if (candidate && end <= candidate.end) {
        this.add(candidate.anchor ?? list.owner, comment, 'leading')
        this.reporter.report(
          'W_COMMENT_MOVED',
          'This comment is inside an expression; it moves to the nearest anchor on the next print.',
          { file: this.file, start, end },
          { hint: 'Put comments above a block, a param, or a wiring statement.' }
        )
        continue
      }
      const previous = candidate
      const next = items[at + 1]
      const commentLine = this.line(start)
      const commentEndLine = this.line(end)
      if (previous && previous.endLine === commentLine) {
        this.add(previous.anchor ?? list.owner, comment, 'trailing')
      } else if (next) {
        const wiring = next.firstWiring && next.startLine - commentEndLine >= 2
        const anchor = wiring ? encodeAnchor({ kind: 'wiring' }) : (next.anchor ?? list.owner)
        this.add(anchor, comment, 'leading')
      } else if (previous && list.tail === 'last-item') {
        this.add(previous.anchor ?? list.owner, comment, 'trailing')
      } else if (list.tail !== 'last-item') {
        this.add(list.tail.anchor, comment, list.tail.placement)
      } else {
        this.add(list.owner, comment, 'leading')
      }
    }
  }
}

/** Index of the last item (sorted by start) starting at or before `offset`, or -1. */
function lastStartingAtOrBefore(items: readonly AnchorItem[], offset: number): number {
  let low = 0
  let high = items.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (items[mid].start <= offset) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
