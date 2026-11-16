import type { Comment } from '@babel/types'
import { encodeAnchor } from '../anchors'
import type { AnchorKey, CodeComment } from '../model'
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
 * Assigns every comment to an anchor (s3 §4 "Comments", build-spec decision 10). The interpreter
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
    const existing = this.comments[anchor]
    if (existing) existing.push(entry)
    else
      Object.defineProperty(this.comments, anchor, {
        value: [entry],
        enumerable: true,
        writable: true,
        configurable: true,
      })
  }

  private innermostList(start: number, end: number): SiblingList | null {
    let best: SiblingList | null = null
    for (const list of this.lists) {
      if (list.start <= start && end <= list.end) {
        if (!best || list.end - list.start < best.end - best.start) best = list
      }
    }
    return best
  }

  /** Assigns `comments` (in source order) once every list is registered. */
  assign(comments: readonly Comment[]): void {
    const footer = encodeAnchor({ kind: 'footer' })
    for (const comment of comments) {
      const start = comment.start ?? 0
      const end = comment.end ?? start
      const list = this.innermostList(start, end)
      if (!list) {
        this.add(footer, comment, 'leading')
        continue
      }
      const items = [...list.items].sort((a, b) => a.start - b.start)
      const container = items.find((item) => item.start <= start && end <= item.end)
      if (container) {
        this.add(container.anchor ?? list.owner, comment, 'leading')
        this.reporter.report(
          'W_COMMENT_MOVED',
          'This comment is inside an expression; it moves to the nearest anchor on the next print.',
          { file: this.file, start, end },
          { hint: 'Put comments above a block, a param, or a wiring statement.' }
        )
        continue
      }
      const commentLine = this.line(start)
      const commentEndLine = this.line(end)
      const previous = [...items].reverse().find((item) => item.end <= start)
      const next = items.find((item) => item.start >= end)
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
