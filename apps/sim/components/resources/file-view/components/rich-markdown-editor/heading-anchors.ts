import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Slugify heading text GitHub-style (lowercase, drop punctuation, collapse whitespace to hyphens) so
 * that `[label](#slug)` fragment links — written against how GitHub renders the same markdown —
 * resolve to the matching heading. Mirrors what `rehype-slug` produced in the old preview.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * The document position of the heading a `#slug` fragment link targets, or -1 if none matches.
 * Computed on demand (at click time) rather than maintained as per-keystroke decorations. Duplicate
 * slugs are disambiguated GitHub-style: `intro`, `intro-1`, `intro-2`, …
 */
export function findHeadingPos(doc: ProseMirrorNode, slug: string): number {
  const seen = new Map<string, number>()
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name !== 'heading') return true
    const base = slugifyHeading(node.textContent)
    if (!base) return true
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    if ((n === 0 ? base : `${base}-${n}`) === slug) found = pos
    return found < 0
  })
  return found
}
