import type { Binding, NodePath } from '@babel/traverse'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5'
import type { ControlInput } from '#control-analysis/inventory'

const traverse =
  typeof traverseModule === 'function'
    ? traverseModule
    : (traverseModule as unknown as { default: typeof traverseModule }).default
const name = (n: t.Node) => (t.isIdentifier(n) ? n.name : t.isStringLiteral(n) ? n.value : '')
interface Element {
  path: NodePath<t.CallExpression>
  binding: Binding
  tag: string
  inputs: Record<string, ControlInput>
  handlers: string[]
  parents: Set<Element>
  children: Set<Element>
  attached: boolean
  uncertain: boolean
  html: number[]
  assignments: number[]
}
export interface DomControl {
  start: number
  line: number
  column: number
  owner: string
  tag: string
  inputs: Record<string, ControlInput>
  handlers: string[]
  attachment: string[]
  uncertain: boolean
}

export function decorativeHtml(html: string): boolean {
  let decorative = true
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node) {
      if (
        ![
          'div',
          'span',
          'svg',
          'g',
          'path',
          'circle',
          'rect',
          'line',
          'polyline',
          'polygon',
          'ellipse',
          'title',
          'defs',
          'clippath',
        ].includes(node.tagName.toLowerCase())
      )
        decorative = false
      if (
        node.attrs.some(
          (a) =>
            /^on/i.test(a.name) || ['tabindex', 'href', 'contenteditable', 'role'].includes(a.name)
        )
      )
        decorative = false
    }
    if ('childNodes' in node) for (const c of node.childNodes) walk(c)
  }
  walk(parseFragment(html))
  return decorative
}

/** Bounded local DOM facts. Event callbacks are observed, never invoked. */
export function inspectImperative(
  ast: t.File,
  value: (node: t.Node, p: NodePath) => ControlInput,
  owner: (p: NodePath) => string
) {
  const elements: Element[] = []
  const byBinding = new Map<Binding, Element>()
  const handled = new Map<number, string>()
  const element = (p: NodePath): Element | undefined =>
    p.isIdentifier() && p.scope.getBinding(p.node.name)
      ? byBinding.get(p.scope.getBinding(p.node.name) as Binding)
      : undefined
  traverse(ast, {
    CallExpression(p) {
      if (
        !t.isMemberExpression(p.node.callee) ||
        !t.isIdentifier(p.node.callee.object, { name: 'document' }) ||
        p.scope.getBinding('document') ||
        name(p.node.callee.property) !== 'createElement' ||
        !t.isStringLiteral(p.node.arguments[0]) ||
        !p.parentPath.isVariableDeclarator() ||
        !t.isIdentifier(p.parentPath.node.id)
      )
        return
      const b = p.scope.getBinding(p.parentPath.node.id.name)
      if (!b?.constant) return
      const e: Element = {
        path: p,
        binding: b,
        tag: p.node.arguments[0].value,
        inputs: {},
        handlers: [],
        parents: new Set(),
        children: new Set(),
        attached: false,
        uncertain: false,
        html: [],
        assignments: [],
      }
      elements.push(e)
      byBinding.set(b, e)
    },
  })
  // Immutable aliases share element identity; don't cross function boundaries.
  for (let i = 0; i < 20; i++) {
    let added = false
    traverse(ast, {
      VariableDeclarator(p) {
        if (!t.isIdentifier(p.node.id) || !p.node.init) return
        const e = element(p.get('init') as NodePath)
        const b = p.scope.getBinding(p.node.id.name)
        if (
          e &&
          b?.constant &&
          !byBinding.has(b) &&
          p.getFunctionParent() === e.path.getFunctionParent()
        ) {
          byBinding.set(b, e)
          added = true
        }
      },
    })
    if (!added) break
  }
  for (const [binding, e] of byBinding)
    for (const reference of binding.referencePaths) {
      const p = reference.parentPath
      if (!p) {
        e.uncertain = true
        continue
      }
      if (p.isVariableDeclarator() && p.get('init') === reference) continue
      if (p.isReturnStatement() && p.getFunctionParent() === e.path.getFunctionParent()) {
        e.attached = true
        continue
      }
      if (p.isBinaryExpression() && ['===', '!=='].includes(p.node.operator)) continue
      if (p.isMemberExpression() && p.get('object') === reference) {
        const property = name(p.node.property)
        const parent = p.parentPath
        if (
          parent.isAssignmentExpression() &&
          parent.get('left') === p &&
          parent.node.operator === '=' &&
          parent.getFunctionParent() === e.path.getFunctionParent()
        ) {
          e.assignments.push(parent.node.start ?? 0)
          if (
            [
              'type',
              'className',
              'textContent',
              'title',
              'role',
              'tabIndex',
              'contentEditable',
            ].includes(property)
          ) {
            const input = value(parent.node.right, parent)
            if (e.inputs[property] && parent.findParent((q) => q.isIfStatement() || q.isLoop()))
              input.unresolved = true
            e.inputs[property] = input
          } else if (property === 'innerHTML') {
            const input = value(parent.node.right, parent)
            if (
              !input.unresolved &&
              input.values?.every((v) => typeof v === 'string' && decorativeHtml(v))
            )
              e.html.push(parent.node.start ?? 0)
            else e.uncertain = true
          } else e.uncertain = true
          continue
        }
        if (
          property === 'style' &&
          parent.isMemberExpression() &&
          ['cssText', 'position', 'top', 'left', 'pointerEvents'].includes(
            name(parent.node.property)
          ) &&
          parent.parentPath.isAssignmentExpression()
        )
          continue
        if (parent.isCallExpression() && parent.get('callee') === p) {
          const args = parent.get('arguments') as NodePath[]
          if (['append', 'appendChild'].includes(property)) {
            for (const arg of args) {
              const child = element(arg)
              if (child) {
                e.children.add(child)
                child.parents.add(e)
              } else e.uncertain = true
            }
          } else if (
            property === 'setAttribute' &&
            t.isStringLiteral(parent.node.arguments[0]) &&
            parent.node.arguments[1]
          ) {
            e.inputs[parent.node.arguments[0].value] = value(parent.node.arguments[1], parent)
          } else if (
            property === 'addEventListener' &&
            t.isStringLiteral(parent.node.arguments[0]) &&
            args[1]?.isFunction()
          ) {
            e.handlers.push(`on${parent.node.arguments[0].value}`)
          } else e.uncertain = true
          continue
        }
        // Read-only comparisons (e.g. restoring focus) are safe, unknown methods are not.
        if (parent.isBinaryExpression()) continue
      }
      if (
        p.isCallExpression() &&
        t.isMemberExpression(p.node.callee) &&
        ['append', 'appendChild'].includes(name(p.node.callee.property))
      ) {
        const target = p.get('callee.object') as NodePath
        const parent = element(target)
        if (parent) {
          parent.children.add(e)
          e.parents.add(parent)
          continue
        }
        if (
          t.isMemberExpression(target.node) &&
          t.isIdentifier(target.node.object, { name: 'document' }) &&
          !target.scope.getBinding('document') &&
          ['body', 'head'].includes(name(target.node.property))
        ) {
          e.attached = true
          continue
        }
      }
      e.uncertain = true
    }
  const attached = (e: Element, seen = new Set<Element>()): boolean =>
    !seen.has(e) && (e.attached || [...e.parents].some((p) => attached(p, new Set(seen).add(e))))
  const uncertainAncestry = (e: Element, seen = new Set<Element>()): boolean =>
    seen.has(e) ||
    e.uncertain ||
    [...e.parents].some((p) => uncertainAncestry(p, new Set(seen).add(e)))
  const interactive = (e: Element) =>
    ['button', 'a', 'select', 'summary', 'input'].includes(e.tag) ||
    e.handlers.length > 0 ||
    Object.keys(e.inputs).some((k) =>
      ['role', 'tabIndex', 'tabindex', 'href', 'contenteditable'].includes(k)
    ) ||
    e.inputs.contentEditable?.values?.some((v) => v !== false && v !== 'false')
  const decorative = (e: Element, seen = new Set<Element>()): boolean =>
    !seen.has(e) &&
    !e.uncertain &&
    !interactive(e) &&
    ['div', 'span'].includes(e.tag) &&
    [...e.children].every((c) => decorative(c, new Set(seen).add(e)))
  const controls: DomControl[] = []
  for (const e of elements) {
    if (!attached(e)) continue
    if (interactive(e) && !uncertainAncestry(e)) {
      controls.push({
        start: e.path.node.start ?? 0,
        line: e.path.node.loc?.start.line ?? 1,
        column: (e.path.node.loc?.start.column ?? 0) + 1,
        owner: owner(e.path),
        tag: e.tag,
        inputs: e.inputs,
        handlers: e.handlers,
        attachment: [...e.parents].map((p) => `${p.tag}:${p.path.node.loc?.start.line}`).sort(),
        uncertain: false,
      })
      handled.set(
        e.path.node.start ?? 0,
        'Literal local control attached to a returned or document DOM tree'
      )
    } else if (decorative(e)) {
      handled.set(
        e.path.node.start ?? 0,
        'Decorative local DOM tree: no control semantics, focus or event inputs'
      )
      for (const at of e.html)
        handled.set(at, 'Literal decorative HTML: no interactive descendants')
    }
  }
  return { controls, handled }
}
