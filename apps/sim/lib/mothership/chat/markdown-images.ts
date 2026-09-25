import type { Nodes } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const parser = unified().use(remarkParse)

/** CommonMark owns image syntax, including code literals, escapes and reference definitions. */
export function collectMarkdownImageSources(content: string): string[] {
  const tree = parser.parse(content)
  const definitions = new Map<string, string>()
  const references: string[] = []
  const sources = new Set<string>()
  function visit(node: Nodes): void {
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url)
    }
    if (node.type === 'image') sources.add(node.url)
    if (node.type === 'imageReference') references.push(node.identifier)
    if ('children' in node) node.children.forEach(visit)
  }
  visit(tree)
  for (const identifier of references) {
    const source = definitions.get(identifier)
    if (source !== undefined) sources.add(source)
  }
  return [...sources]
}
