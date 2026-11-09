import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import GithubSlugger from 'github-slugger'

/** Resolves GitHub heading fragments, including Unicode and collisions with existing suffixes. */
function findHeadingPos(doc: ProseMirrorNode, slug: string): number {
  const slugger = new GithubSlugger()
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name !== 'heading') return true
    if (slugger.slug(node.textContent) === slug) found = pos
    return false
  })
  return found
}

/** Scrolls within this editor without navigating the page or changing the document selection. */
export function scrollToHeading(view: EditorView, fragment: string): boolean {
  let slug: string
  try {
    slug = decodeURIComponent(fragment.slice(1))
  } catch {
    return false
  }
  const pos = slug ? findHeadingPos(view.state.doc, slug) : 0
  if (pos < 0) return false
  const target = slug ? view.nodeDOM(pos) : view.dom
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}
