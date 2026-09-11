import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { appearanceAttributes, mediaElement } from '#design-diff/appearance'
import { location, propertyName, symbolName, traverse } from '#design-diff/ast'
import { svgMovement } from '#design-diff/movement'
import { child, children, object, type Resolver } from '#design-diff/resolve'
import type { Data, Definition, Evidence } from '#design-diff/types'

const nonvisualAttributes = /^(?:key|ref|on[A-Z].*)$/
const knownAttributes =
  /^(?:className|class|style|src|srcSet|sizes|alt|title|placeholder|value|defaultValue|checked|defaultChecked|disabled|hidden|open|type|width|height|size|rows|cols|fill|stroke.*|viewBox|d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|transform|opacity|color|animate|initial|exit|transition|while.*|layout.*|dangerouslySetInnerHTML|children)$/

export function extractTsx(resolver: Resolver, file: string): Definition[] {
  const definitions: Definition[] = []
  const counts = new Map<string, number>()
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
    if (
      resolver.tree.config.mediaSymbols?.some(
        (entry) => new RegExp(entry.file).test(file) && entry.names.includes(symbolName(path))
      )
    )
      return true
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
    const tag = element?.isJSXElement() ? propertyName(element.node.openingElement.name) : ''
    const prefix = `${symbol}:${kind}:${property}:${tag}`
    const count = counts.get(prefix) ?? 0
    counts.set(prefix, count + 1)
    const conditions: Data[] = []
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
      if (media(path)) return
      emit(path, 'markup', propertyName(path.node.openingElement.name), literal(null))
      const definition = definitions[definitions.length - 1]
      elements.set(path.node, definition.key)
      definition.appearance = { element: definition.key }
    },
    JSXAttribute(path) {
      const name = propertyName(path.node.name)
      if (!appearanceAttributes.test(name) || media(path)) return
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
    CallExpression(path) {
      if (media(path)) return
      const name = propertyName(path.node.callee)
      if (resolver.tree.config.variantFunctions.includes(name))
        emit(path, 'class', 'variants', resolver.evaluate(path, file))
      if (
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
  })
  return definitions
}
