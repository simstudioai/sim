import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { appearanceAttributes, mediaElement } from '#design-diff/appearance'
import {
  fingerprint,
  jsxText,
  location,
  propertyName,
  symbolName,
  traverse,
} from '#design-diff/ast'
import { svgMovement } from '#design-diff/movement'
import { child, children, object, type Resolver } from '#design-diff/resolve'
import type { Data, Definition, Evidence } from '#design-diff/types'

const nonvisualAttributes = /^(?:key|ref|on[A-Z].*)$/
const knownAttributes =
  /^(?:className|class|style|src|srcSet|sizes|alt|title|placeholder|value|defaultValue|checked|defaultChecked|disabled|hidden|open|type|width|height|size|rows|cols|fill|stroke.*|viewBox|d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|transform|opacity|color|animate|initial|exit|transition|while.*|layout.*|dangerouslySetInnerHTML|children)$/

export function extractTsx(resolver: Resolver, file: string, appearanceOnly = false): Definition[] {
  const definitions: Definition[] = []
  const counts = new Map<string, number>()
  const guards = new WeakMap<t.Node, { value: Data; evidence: Evidence }[]>()
  const elements = new WeakMap<t.Node, string>()
  const domReceiver = (path: NodePath, seen = new Set<t.Node>()): boolean => {
    if (!path.node || seen.has(path.node) || seen.size > 16) return false
    seen.add(path.node)
    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(path.node.name)
      if (!binding) return path.node.name === 'document'
      return binding.path.isVariableDeclarator() && domReceiver(child(binding.path, 'init'), seen)
    }
    if (path.isCallExpression()) return domReceiver(child(path, 'callee'), seen)
    if (path.isMemberExpression()) return domReceiver(child(path, 'object'), seen)
    return false
  }
  const media = (path: NodePath): boolean => {
    for (let node: NodePath | null = path; node; node = node.parentPath) {
      if (!node.isJSXElement()) continue
      const name = propertyName(node.node.openingElement.name)
      if (mediaElement.test(name)) return true
      const binding = node.scope.getBinding(name.split('.')[0])
      const declaration = binding?.path.parentPath
      if (declaration?.isImportDeclaration()) {
        const module = declaration.node.source.value
        if (
          /(?:^|\/)icons?(?:\/|$)/.test(module) ||
          resolver.tree.config.mediaModules?.some(
            (prefix) => module === prefix || module.startsWith(`${prefix}/`)
          )
        )
          return true
        const imported = binding?.path.isImportSpecifier()
          ? propertyName(binding.path.node.imported)
          : 'default'
        const origin = resolver.tree.graph?.imported(file, module, imported)
        if (
          origin?.origins.length &&
          origin.origins.every((item) => /(?:^|\/)icons?(?:\/|\.[cm]?[jt]sx?$)/.test(item.file))
        )
          return true
      }
    }
    return false
  }
  const emit = (path: NodePath, kind: Definition['kind'], property: string, evidence: Evidence) => {
    const symbol = symbolName(path)
    const element = path.findParent((parent) => parent.isJSXElement())
    const tag =
      appearanceOnly && element?.isJSXElement()
        ? propertyName(element.node.openingElement.name)
        : ''
    const prefix = `${symbol}:${kind}:${property}:${tag}`
    const count = counts.get(prefix) ?? 0
    counts.set(prefix, count + 1)
    const conditions: Data[] = []
    const owner = path.getFunctionParent()
    if (owner && !appearanceOnly) {
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
    for (let p = appearanceOnly ? null : path.parentPath; p; p = p.parentPath) {
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
    ImportDeclaration(path) {
      if (appearanceOnly) return
      if (
        path.node.importKind === 'type' ||
        !/\.(?:css|scss|sass|less)(?:[?#].*)?$/.test(path.node.source.value)
      )
        return
      const target = resolver.tree.resolve(file, path.node.source.value)
      emit(path, 'review', 'infrastructure', {
        value: path.node.source.value,
        dependencies: target ? [file, target] : [file],
        unresolved: ['Stylesheet import order, side effects and selector reach are not executed'],
      })
    },
    JSXElement(path) {
      if (appearanceOnly) {
        if (media(path)) return
        emit(path, 'markup', propertyName(path.node.openingElement.name), literal(null))
        const definition = definitions[definitions.length - 1]
        elements.set(path.node, definition.key)
        definition.appearance = { element: definition.key }
        return
      }
      const opening = path.node.openingElement
      const name = propertyName(opening.name)
      const childShapes = path.node.children.flatMap((node) => {
        if (t.isJSXText(node)) return jsxText(node.value) ? ['text'] : []
        if (t.isJSXExpressionContainer(node) && t.isJSXEmptyExpression(node.expression)) return []
        return [t.isJSXElement(node) ? propertyName(node.openingElement.name) : node.type]
      })
      const attributeOrder = opening.attributes
        .filter(
          (attr) =>
            !t.isJSXAttribute(attr) ||
            (!nonvisualAttributes.test(propertyName(attr.name)) &&
              !resolver.eventOnlyProp(
                child(child(path, 'openingElement'), 'name'),
                propertyName(attr.name),
                file
              ))
        )
        .map((attr) => (t.isJSXAttribute(attr) ? propertyName(attr.name) : '...spread'))
      const evidence = literal({ tag: name, children: childShapes, attributeOrder })
      if (/^[A-Z]/.test(name)) {
        const binding = path.scope.getBinding(name.split('.')[0])
        if (
          binding &&
          (binding.path.isImportSpecifier() ||
            binding.path.isImportDefaultSpecifier() ||
            binding.path.isImportNamespaceSpecifier())
        ) {
          const parent = binding.path.parentPath
          if (parent.isImportDeclaration()) {
            const imported = binding.path.isImportSpecifier()
              ? propertyName(binding.path.node.imported)
              : binding.path.isImportNamespaceSpecifier()
                ? (name.split('.')[1] ?? '*')
                : 'default'
            const origin = resolver.tree.graph?.imported(file, parent.node.source.value, imported)
            if (origin)
              evidence.dependencies.push(
                ...origin.routes,
                ...origin.origins.map((item) => item.file)
              )
            if (origin && (origin.uncertain || !origin.origins.length))
              evidence.unresolved.push(
                'Component import could not be resolved to a unique implementation'
              )
            if (origin?.effects.length)
              evidence.unresolved.push('Imported module effects are not executed')
            evidence.value = {
              tag: name,
              children: childShapes,
              attributeOrder,
              from: parent.node.source.value,
              imported,
              origin: origin ?? null,
            }
          }
        }
      }
      emit(path, 'markup', name, evidence)
    },
    JSXAttribute(path) {
      const name = propertyName(path.node.name)
      if (appearanceOnly && (!appearanceAttributes.test(name) || media(path))) return
      if (nonvisualAttributes.test(name)) return
      if (resolver.eventOnlyProp(child(path.parentPath, 'name'), name, file)) return
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
        emit(
          path,
          /^(?:className|class)$|ClassName$/.test(name) ? 'class' : 'attribute',
          name,
          evidence
        )
        const tag = propertyName(
          path.parentPath.node && (path.parentPath.node as t.JSXOpeningElement).name
        )
        const binding = path.scope.getBinding(tag.split('.')[0])
        definitions[definitions.length - 1].appearance = {
          shared: binding?.path.parentPath?.isImportDeclaration() ?? false,
          element: path.parentPath.parentPath
            ? elements.get(path.parentPath.parentPath.node)
            : undefined,
        }
      }
    },
    JSXSpreadAttribute(path) {
      if (appearanceOnly) return
      emit(path, 'review', 'spread', resolver.evaluate(child(path, 'argument'), file))
    },
    JSXText(path) {
      if (appearanceOnly) return
      const value = jsxText(path.node.value)
      if (value) emit(path, 'content', 'text', literal(value))
    },
    JSXExpressionContainer(path) {
      if (appearanceOnly) return
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
      if (
        appearanceOnly &&
        t.isMemberExpression(path.node.callee) &&
        domReceiver(child(child(path, 'callee'), 'object'))
      ) {
        const method = propertyName(path.node.callee.property)
        const args = children(path, 'arguments')
        if (method === 'setAttribute' && args[0]?.isStringLiteral() && args[1]) {
          const property = args[0].node.value
          if (appearanceAttributes.test(property) && property !== 'style')
            emit(
              path,
              /^(?:class|className)$/.test(property) ? 'class' : 'attribute',
              property,
              resolver.evaluate(args[1], file)
            )
        }
        if (method === 'setProperty' && args[0]?.isStringLiteral() && args[1])
          emit(path, 'style', args[0].node.value, resolver.evaluate(args[1], file))
      }
      if (!appearanceOnly && resolver.renderingCall(path, file))
        emit(path, 'review', 'imperative-rendering', resolver.evaluate(path, file))
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
      if (appearanceOnly) {
        if (
          t.isMemberExpression(lhs) &&
          t.isMemberExpression(lhs.object) &&
          propertyName(lhs.object.property) === 'style' &&
          domReceiver(child(child(path, 'left'), 'object'))
        )
          emit(
            path,
            'style',
            propertyName(lhs.property),
            resolver.evaluate(child(path, 'right'), file)
          )
        return
      }
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
      if (appearanceOnly) return
      /** A tag is only a standalone visual definition for a known styling binding. SQL and String.raw still participate when explicitly read by a visual input. */
      const tag = child(path, 'tag')
      const root = tag.isMemberExpression() ? child(tag, 'object') : tag
      if (!root.isIdentifier()) return
      const binding = root.scope.getBinding(root.node.name)
      const declaration = binding?.path.parentPath
      if (
        declaration?.isImportDeclaration() &&
        /^(?:styled-components|@emotion\/)/.test(declaration.node.source.value)
      )
        emit(path, 'review', 'tagged-template', resolver.evaluate(path, file))
    },
  })
  return definitions
}
