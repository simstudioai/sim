import postcss, { type ChildNode, type Node } from 'postcss'
import type { Definition } from '#design-diff/types'

function context(node: ChildNode): string[] {
  const result: string[] = []
  let parent: Node | undefined = node.parent
  while (parent && parent.type !== 'root' && parent.type !== 'document') {
    result.unshift(
      'selector' in parent
        ? String(parent.selector)
        : 'name' in parent && 'params' in parent
          ? `@${parent.name} ${parent.params}`
          : parent.type
    )
    parent = parent.parent
  }
  return result
}

export function extractCss(source: string, file: string): Definition[] {
  const result: Definition[] = []
  const root = postcss.parse(source, { from: file })
  let order = 0
  root.walk((node) => {
    if (node.type === 'comment') return
    const chain = context(node)
    const selector = chain.join(' > ')
    const base = {
      location: {
        file,
        line: node.source?.start?.line ?? 1,
        column: node.source?.start?.column ?? 1,
      },
      symbol: selector || 'stylesheet',
      conditions: chain,
      dependencies: [file],
      unresolved: [],
    }
    if (node.type === 'decl') {
      result.push({
        ...base,
        key: `css:${selector}:${node.prop}:${order}`,
        kind: 'css',
        property: node.prop,
        value: { value: node.value, important: node.important, order: order++ },
      })
    } else if (node.type === 'atrule' && !node.nodes) {
      result.push({
        ...base,
        key: `at:${order}`,
        kind: ['import', 'plugin', 'config', 'apply', 'source'].includes(node.name)
          ? 'review'
          : 'css',
        property: `@${node.name}`,
        value: { params: node.params, order: order++ },
      })
    }
  })
  return result
}

/** Stable CSS representation, retaining selector, conditional and cascade order. */
export function cssValue(source: string): string {
  const root = postcss.parse(source)
  root.walkComments((comment) => {
    comment.remove()
  })
  const value: unknown[] = []
  root.walk((node) => {
    if (node.type === 'decl') value.push([context(node), node.prop, node.value, node.important])
    if (node.type === 'atrule' && !node.nodes) value.push([context(node), node.name, node.params])
  })
  return JSON.stringify(value)
}
