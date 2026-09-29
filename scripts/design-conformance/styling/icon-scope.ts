import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

type ImportResolver = (p: NodePath, local: string) => string | undefined
const artwork = new Set(['svg', 'img', 'image', 'video', 'audio', 'canvas', 'picture', 'source'])
const wrappers = new Set(['div', 'span', 'i'])
const key = (n: t.Node) =>
  t.isIdentifier(n) || t.isJSXIdentifier(n) ? n.name : t.isStringLiteral(n) ? n.value : ''

/** Explicit presentation contracts plus bounded syntax; names alone never establish icon scope. */
export function iconScope(imported: ImportResolver) {
  const cache = new WeakMap<t.Node, boolean>()
  let evidence = 0
  const known = (p: NodePath, local: string) => {
    const ref = imported(p, local) ?? ''
    return (
      /^(?:next\/(?:legacy\/)?image#|lucide-react#|react-icons\/|@sim\/emcn\/icons#)/.test(ref) ||
      /(?:^|\/)icons(?:\/|#)/.test(ref) ||
      /^apps\/sim\/components\/ui(?:\/thinking-loader)?#ThinkingLoader$/.test(ref)
    )
  }
  const slot = (p: NodePath): boolean => {
    const attr = p.findParent((q) => q.isJSXAttribute())
    if (!attr?.isJSXAttribute() || !attr.parentPath.isJSXOpeningElement()) return false
    const tag = attr.parentPath.node.name
    if (!t.isJSXIdentifier(tag)) return false
    const ref = imported(attr, tag.name) ?? ''
    const prop = key(attr.node.name)
    return (
      (/^@sim\/emcn#(?:Chip\w*|Button|Badge|DropdownMenuItem)$/.test(ref) &&
        ['icon', 'leftIcon', 'rightIcon'].includes(prop)) ||
      (/^apps\/sim\/app\/workspace\/\[workspaceId\]\/settings\/components\/settings-resource-row#SettingsResourceRow$/.test(
        ref
      ) &&
        prop === 'icon')
    )
  }
  const only = (p: NodePath, active: Set<t.Node>, depth: number, allowSlot = false): boolean => {
    if (!p.node || depth > 12 || active.has(p.node)) return false
    const next = new Set(active).add(p.node)
    const rec = (q: NodePath) => only(q, next, depth + 1, allowSlot)
    if (p.isJSXText()) return !p.node.value.trim()
    if (p.isNullLiteral() || p.isBooleanLiteral() || p.isJSXEmptyExpression()) return true
    if (p.isJSXExpressionContainer()) return rec(p.get('expression'))
    if (p.isTSAsExpression() || p.isTSSatisfiesExpression())
      return rec(p.get('expression') as NodePath)
    if (p.isConditionalExpression()) return rec(p.get('consequent')) && rec(p.get('alternate'))
    if (p.isLogicalExpression())
      return rec(p.get('right')) && (p.node.operator === '&&' || rec(p.get('left')))
    if (p.isJSXFragment()) return p.get('children').every(rec)
    if (p.isIdentifier()) {
      if (known(p, p.node.name)) {
        evidence++
        return true
      }
      const binding = p.scope.getBinding(p.node.name)
      if (!binding?.constant) return false
      if (binding.path.isVariableDeclarator()) return rec(binding.path.get('init') as NodePath)
      if (binding.path.isFunctionDeclaration()) return rec(binding.path)
    }
    if (p.isFunction()) {
      const body = p.get('body') as NodePath
      if (!body.isBlockStatement()) return rec(body)
      const returns: NodePath[] = []
      body.traverse({
        Function(q) {
          q.skip()
        },
        ReturnStatement(q) {
          if (q.node.argument) returns.push(q.get('argument') as NodePath)
        },
      })
      return returns.length > 0 && returns.every(rec)
    }
    if (!p.isJSXElement()) return false
    const tag = p.node.openingElement.name
    if (!t.isJSXIdentifier(tag)) return false
    // ThinkingLoader also has a text-bearing presentation. Only its glyph-only use is media.
    if (
      (imported(p, tag.name) ?? '').endsWith('#ThinkingLoader') &&
      p.node.openingElement.attributes.some(
        (a) =>
          t.isJSXSpreadAttribute(a) ||
          (t.isJSXAttribute(a) &&
            key(a.name) === 'label' &&
            !(t.isStringLiteral(a.value) && a.value.value === ''))
      )
    )
      return false
    if (artwork.has(tag.name) || known(p, tag.name)) {
      evidence++
      return true
    }
    const attrs = p.node.openingElement.attributes
    if (
      attrs.some(
        (a) =>
          t.isJSXSpreadAttribute(a) ||
          (t.isJSXAttribute(a) &&
            /^(?:on[A-Z]|role$|tabIndex$|dangerouslySetInnerHTML$)/.test(key(a.name)))
      )
    )
      return false
    if (!p.get('children').every(rec)) return false
    if (wrappers.has(tag.name))
      return p.node.children.some((c) => !t.isJSXText(c) || Boolean(c.value.trim()))
    if (/^[A-Z]/.test(tag.name)) {
      const binding = p.scope.getBinding(tag.name)
      if (binding?.constant) {
        if (binding.path.isVariableDeclarator() && rec(binding.path.get('init') as NodePath))
          return true
        if (binding.path.isFunctionDeclaration() && rec(binding.path)) return true
      }
      if (allowSlot) evidence++
      return allowSlot
    }
    return false
  }
  return (p: NodePath): boolean => {
    const saved = cache.get(p.node)
    if (saved !== undefined) return saved
    evidence = 0
    const result = only(p, new Set(), 0, slot(p)) && evidence > 0
    cache.set(p.node, result)
    return result
  }
}
