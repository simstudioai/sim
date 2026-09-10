import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { fingerprint, location, propertyName, symbolName, traverse } from '#design-diff/ast'
import { svgMovement } from '#design-diff/movement'
import { child, children, object, type Resolver } from '#design-diff/resolve'
import type { Data, Definition, Evidence } from '#design-diff/types'

const nonvisualAttributes = /^(?:key|ref|on[A-Z].*)$/
const knownAttributes =
  /^(?:className|class|style|src|srcSet|sizes|alt|title|placeholder|value|defaultValue|checked|defaultChecked|disabled|hidden|open|type|width|height|size|rows|cols|fill|stroke.*|viewBox|d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|transform|opacity|color|animate|initial|exit|transition|while.*|layout.*|dangerouslySetInnerHTML|children)$/

/** React's line-wise JSX text whitespace semantics, including explicit single-line spaces. */
export function jsxText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let last = 0
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) last = i
  })
  return lines
    .map((line, i) => {
      let value = line.replace(/\t/g, ' ')
      if (i !== 0) value = value.replace(/^ +/, '')
      if (i !== lines.length - 1) value = value.replace(/ +$/, '')
      return value ? value + (i !== last ? ' ' : '') : ''
    })
    .join('')
}

export function extractTsx(resolver: Resolver, file: string): Definition[] {
  const definitions: Definition[] = []
  const counts = new Map<string, number>()
  const guards = new WeakMap<t.Node, { value: Data; evidence: Evidence }[]>()
  const emit = (path: NodePath, kind: Definition['kind'], property: string, evidence: Evidence) => {
    const symbol = symbolName(path)
    const prefix = `${symbol}:${kind}:${property}`
    const count = counts.get(prefix) ?? 0
    counts.set(prefix, count + 1)
    const conditions: Data[] = []
    const owner = path.getFunctionParent()
    if (owner) {
      if (!guards.has(owner.node)) {
        const entries: { value: Data; evidence: Evidence }[] = []
        owner.traverse({
          Function(p) {
            p.skip()
          },
          IfStatement(p) {
            let returns = false
            p.traverse({
              Function(nested) {
                nested.skip()
              },
              ReturnStatement() {
                returns = true
              },
            })
            if (returns) {
              const test = resolver.evaluate(child(p, 'test'), file)
              entries.push({
                value: { guard: test.value, alternate: !!p.node.alternate },
                evidence: test,
              })
            }
          },
        })
        guards.set(owner.node, entries)
      }
      for (const guard of guards.get(owner.node) ?? []) {
        conditions.push(guard.value)
        evidence.dependencies.push(...guard.evidence.dependencies)
        evidence.unresolved.push(...guard.evidence.unresolved)
      }
    }
    for (let p = path.parentPath; p; p = p.parentPath) {
      if (p.isConditionalExpression() || p.isIfStatement()) {
        const test = resolver.evaluate(child(p, 'test'), file)
        conditions.push({
          test: test.value,
          branch:
            (path.parentPath === p ? path : path.findParent((parent) => parent.parentPath === p))
              ?.key === 'alternate'
              ? 'else'
              : 'then',
        })
        evidence.dependencies.push(...test.dependencies)
        evidence.unresolved.push(...test.unresolved)
      }
      if (p.isLogicalExpression()) {
        const test = resolver.evaluate(child(p, 'left'), file)
        conditions.push({ operator: p.node.operator, test: test.value })
        evidence.dependencies.push(...test.dependencies)
        evidence.unresolved.push(...test.unresolved)
      }
      if (p.isSwitchCase() && p.parentPath.isSwitchStatement()) {
        const discriminant = resolver.evaluate(child(p.parentPath, 'discriminant'), file)
        const test = resolver.evaluate(child(p, 'test'), file)
        conditions.push({ switch: discriminant.value, case: test.value })
        evidence.dependencies.push(...discriminant.dependencies, ...test.dependencies)
        evidence.unresolved.push(...discriminant.unresolved, ...test.unresolved)
      }
      if (
        p.isForStatement() ||
        p.isForOfStatement() ||
        p.isForInStatement() ||
        p.isWhileStatement() ||
        p.isDoWhileStatement()
      ) {
        const iterable = resolver.evaluate(
          child(p, p.isForOfStatement() || p.isForInStatement() ? 'right' : 'test'),
          file
        )
        conditions.push({ loop: p.node.type, test: iterable.value, syntax: fingerprint(p.node) })
        evidence.dependencies.push(...iterable.dependencies)
        evidence.unresolved.push('Loop rendering requires review', ...iterable.unresolved)
      }
    }
    definitions.push({
      ...evidence,
      dependencies: [...new Set(evidence.dependencies)].sort(),
      unresolved: [...new Set(evidence.unresolved)].sort(),
      key: `${prefix}:${count}`,
      kind,
      property,
      symbol,
      location: location(file, path.node),
      conditions,
      movement: svgMovement(path),
    })
  }
  const literal = (value: Data): Evidence => ({ value, dependencies: [file], unresolved: [] })
  const ast = resolver.module(file).ast
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement
      const name = propertyName(opening.name)
      const childShapes = path.node.children.flatMap((node) => {
        if (t.isJSXText(node)) return jsxText(node.value) ? ['text'] : []
        if (t.isJSXExpressionContainer(node) && t.isJSXEmptyExpression(node.expression)) return []
        return [t.isJSXElement(node) ? propertyName(node.openingElement.name) : node.type]
      })
      const attributeOrder = opening.attributes
        .filter(
          (attr) => !t.isJSXAttribute(attr) || !nonvisualAttributes.test(propertyName(attr.name))
        )
        .map((attr) => (t.isJSXAttribute(attr) ? propertyName(attr.name) : '...spread'))
      const evidence = literal({ tag: name, children: childShapes, attributeOrder })
      if (/^[A-Z]/.test(name)) {
        const binding = path.scope.getBinding(name.split('.')[0])
        if (
          binding &&
          (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier())
        ) {
          const parent = binding.path.parentPath
          if (parent.isImportDeclaration())
            evidence.value = {
              tag: name,
              children: childShapes,
              attributeOrder,
              from: parent.node.source.value,
              imported: binding.path.isImportSpecifier()
                ? propertyName(binding.path.node.imported)
                : 'default',
            }
        }
      }
      emit(path, 'markup', name, evidence)
    },
    JSXAttribute(path) {
      const name = propertyName(path.node.name)
      if (nonvisualAttributes.test(name)) return
      const value = child(path, 'value')
      const evidence = value.node ? resolver.evaluate(value, file) : literal(true)
      if (
        name === 'style' &&
        object(evidence.value) &&
        !Object.keys(evidence.value).some((key) => key.startsWith('$'))
      ) {
        for (const [precedence, [property, data]] of Object.entries(evidence.value).entries()) {
          emit(path, 'style', property, { ...evidence, value: data })
          definitions[definitions.length - 1].conditions.push({ declarationPrecedence: precedence })
        }
      } else {
        if (!knownAttributes.test(name))
          evidence.unresolved.push('Custom prop or selector attribute may affect rendering')
        emit(path, name === 'className' || name === 'class' ? 'class' : 'attribute', name, evidence)
      }
    },
    JSXSpreadAttribute(path) {
      emit(path, 'review', 'spread', resolver.evaluate(child(path, 'argument'), file))
    },
    JSXText(path) {
      const value = jsxText(path.node.value)
      if (value) emit(path, 'content', 'text', literal(value))
    },
    JSXExpressionContainer(path) {
      if (
        path.parentPath.isJSXAttribute() ||
        t.isJSXEmptyExpression(path.node.expression) ||
        t.isJSXElement(path.node.expression) ||
        t.isJSXFragment(path.node.expression)
      )
        return
      emit(path, 'content', 'expression', resolver.evaluate(child(path, 'expression'), file))
    },
    CallExpression(path) {
      const name = propertyName(path.node.callee)
      if (resolver.tree.config.variantFunctions.includes(name))
        emit(path, 'class', 'variants', resolver.evaluate(path, file))
      const rendering =
        /(?:createElement|createPortal|createTextNode|appendChild|insertAdjacentHTML|insertRule|deleteRule|replaceSync|setAttribute|setProperty|animate|addColorStop|fillRect|strokeRect|drawImage|fillText|strokeText|getContext)$/.test(
          name === '?' && t.isMemberExpression(path.node.callee)
            ? propertyName(path.node.callee.property)
            : name
        )
      if (rendering) emit(path, 'review', 'imperative-rendering', resolver.evaluate(path, file))
      if (file.startsWith('apps/desktop/') && t.isMemberExpression(path.node.callee)) {
        const method = propertyName(path.node.callee.property)
        if (
          /^set(?:BackgroundColor|TitleBarOverlay|Opacity|Vibrancy|BackgroundMaterial|Size|Bounds|MinimumSize|MaximumSize|FullScreen|SimpleFullScreen|AutoHideMenuBar|MenuBarVisibility|Shape|Icon|Image|Position)$/.test(
            method
          )
        ) {
          for (const argument of children(path, 'arguments'))
            emit(path, 'native', method, resolver.evaluate(argument, file))
        }
      }
    },
    AssignmentExpression(path) {
      const lhs = path.node.left
      if (
        file.startsWith('apps/desktop/') &&
        t.isMemberExpression(lhs) &&
        propertyName(lhs.property) === 'themeSource'
      )
        emit(path, 'native', 'themeSource', resolver.evaluate(child(path, 'right'), file))
      if (
        t.isMemberExpression(lhs) &&
        /^(?:innerHTML|outerHTML|textContent|className|cssText|fillStyle|strokeStyle|font)$/.test(
          propertyName(lhs.property)
        )
      )
        emit(path, 'review', 'imperative-rendering', resolver.evaluate(child(path, 'right'), file))
      if (
        t.isMemberExpression(lhs) &&
        t.isMemberExpression(lhs.object) &&
        propertyName(lhs.object.property) === 'style'
      )
        emit(
          path,
          'style',
          propertyName(lhs.property),
          resolver.evaluate(child(path, 'right'), file)
        )
    },
    NewExpression(path) {
      if (
        !file.startsWith('apps/desktop/') ||
        !t.isIdentifier(path.node.callee, { name: 'BrowserWindow' })
      )
        return
      const args = children(path, 'arguments')
      if (!args[0]) return
      const evidence = resolver.evaluate(args[0], file)
      if (object(evidence.value)) {
        for (const [name, value] of Object.entries(evidence.value)) {
          if (resolver.tree.config.nativeAppearance.includes(name))
            emit(path, 'native', name, { ...evidence, value })
        }
        if (evidence.unresolved.length) emit(path, 'review', 'native-options', evidence)
      } else emit(path, 'review', 'native-options', evidence)
    },
    TaggedTemplateExpression(path) {
      emit(path, 'review', 'tagged-template', {
        ...literal(fingerprint(path.node)),
        unresolved: ['Tagged templates are not executed'],
      })
    },
  })
  if (definitions.some((definition) => definition.property === 'imperative-rendering')) {
    definitions.push({
      key: 'imperative-context',
      kind: 'review',
      property: 'imperative-context',
      value: fingerprint(ast.program),
      location: location(file, ast.program),
      symbol: 'module',
      conditions: [],
      dependencies: [file],
      unresolved: ['Imperative rendering may depend on surrounding source'],
    })
  }
  return definitions
}
