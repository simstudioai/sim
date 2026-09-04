import { findParentNode, InputRule } from '@tiptap/core'
import type { NodeType, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { canJoin } from '@tiptap/pm/transform'

interface ListJoinOptions {
  joinBefore?: boolean
  compatible?: (list: ProseMirrorNode, next: ProseMirrorNode) => boolean
}

/** Mirrors the stock backward join without renumbering a restart or changing list styling. */
export function orderedListContinues(list: ProseMirrorNode, next: ProseMirrorNode): boolean {
  return (
    (!list.attrs.type || list.attrs.type === '1') &&
    next.attrs.start === list.attrs.start + list.childCount &&
    list.hasMarkup(next.type, { ...next.attrs, start: list.attrs.start }, next.marks)
  )
}

/**
 * Keeps adjacent-list joins in the original input-rule transaction so undo restores the marker
 * and the neighboring lists together. Only the newly wrapped list's immediate siblings qualify;
 * paragraphs, incompatible list types, and explicit numbering restarts remain boundaries.
 */
export function joinListInputRules(
  rules: InputRule[],
  listType: NodeType,
  { joinBefore = false, compatible = (list, next) => next.sameMarkup(list) }: ListJoinOptions = {}
): InputRule[] {
  return rules.map(
    (rule) =>
      new InputRule({
        find: rule.find,
        undoable: rule.undoable,
        handler: (props) => {
          if (rule.handler(props) === null) return null

          const { tr } = props.state
          let list = findParentNode((node) => node.type === listType)(tr.selection)
          if (!list) return

          if (joinBefore) {
            const previous = tr.doc.resolve(list.pos).nodeBefore
            if (previous && compatible(previous, list.node) && canJoin(tr.doc, list.pos)) {
              tr.join(list.pos)
              list = findParentNode((node) => node.type === listType)(tr.selection)
              if (!list) return
            }
          }

          const after = list.pos + list.node.nodeSize
          const next = tr.doc.nodeAt(after)
          if (next && compatible(list.node, next) && canJoin(tr.doc, after)) tr.join(after)
        },
      })
  )
}
