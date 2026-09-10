import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { propertyName } from '#design-diff/ast'
import type { Definition } from '#design-diff/types'

/** Movement proof is intentionally limited to one untransformed primitive in a fixed SVG canvas. */
export function svgMovement(path: NodePath): Definition['movement'] {
  if (!path.isJSXAttribute() || !['x', 'y', 'cx', 'cy'].includes(propertyName(path.node.name)))
    return undefined
  const primitive = path.parentPath.parentPath
  if (
    !primitive?.isJSXElement() ||
    !['rect', 'circle'].includes(propertyName(primitive.node.openingElement.name))
  )
    return undefined
  const canvas = primitive.parentPath
  if (!canvas?.isJSXElement() || propertyName(canvas.node.openingElement.name) !== 'svg')
    return undefined
  if (canvas.findParent((parent) => parent.isJSXElement() || parent.isJSXFragment()))
    return undefined
  if (canvas.node.children.filter((n) => !t.isJSXText(n) || n.value.trim()).length !== 1)
    return undefined
  const attrs = (node: t.JSXElement): Record<string, string> | undefined => {
    const result: Record<string, string> = {}
    for (const attr of node.openingElement.attributes) {
      if (!t.isJSXAttribute(attr)) return undefined
      const name = propertyName(attr.name)
      if (
        ![
          'width',
          'height',
          'viewBox',
          'x',
          'y',
          'cx',
          'cy',
          'r',
          'rx',
          'ry',
          'fill',
          'xmlns',
        ].includes(name)
      )
        return undefined
      if (t.isStringLiteral(attr.value)) result[name] = attr.value.value
      else if (t.isJSXExpressionContainer(attr.value) && t.isNumericLiteral(attr.value.expression))
        result[name] = String(attr.value.expression.value)
      else return undefined
    }
    return result
  }
  const outer = attrs(canvas.node)
  const inner = attrs(primitive.node)
  if (
    !outer ||
    !inner ||
    !/^\d+(?:\.\d+)?$/.test(outer.width ?? '') ||
    !/^\d+(?:\.\d+)?$/.test(outer.height ?? '')
  )
    return undefined
  const viewport = (outer.viewBox ?? `0 0 ${outer.width} ${outer.height}`)
    .trim()
    .split(/[ ,]+/)
    .map(Number)
  if (
    viewport.length !== 4 ||
    !viewport.every(Number.isFinite) ||
    viewport[2] <= 0 ||
    viewport[3] <= 0
  )
    return undefined
  const circle = propertyName(primitive.node.openingElement.name) === 'circle'
  const x = Number(inner[circle ? 'cx' : 'x'] ?? 0)
  const y = Number(inner[circle ? 'cy' : 'y'] ?? 0)
  const w = Number(inner[circle ? 'r' : 'width'])
  const h = Number(inner[circle ? 'r' : 'height'])
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return undefined
  const bounds = circle ? [x - w, y - h, x + w, y + h] : [x, y, x + w, y + h]
  const appearance = { ...inner, x: '', y: '', cx: '', cy: '', canvas: outer }
  return { bounds, viewport, appearance }
}

export function pureMovement(before: Definition, after: Definition): boolean {
  const a = before.movement
  const b = after.movement
  if (!a || !b || before.unresolved.length || after.unresolved.length) return false
  if (before.conditions.length || after.conditions.length) return false
  if (
    JSON.stringify(a.appearance) !== JSON.stringify(b.appearance) ||
    JSON.stringify(before.conditions) !== JSON.stringify(after.conditions)
  )
    return false
  return [a, b].every(
    ({ bounds: [left, top, right, bottom], viewport: [x, y, width, height] }) =>
      left > x && top > y && right < x + width && bottom < y + height
  )
}

export function movementProperty(property: string): boolean {
  return /^(?:x|y|cx|cy|top|right|bottom|left|inset.*|translate.*|transform|margin.*|gap|rowGap|columnGap|align.*|justify.*|position|trafficLightPosition)$/i.test(
    property
  )
}
