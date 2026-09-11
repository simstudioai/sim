import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import {
  canonicalJson,
  fingerprint,
  jsxText,
  parseSource,
  propertyName,
  symbolName,
  traverse,
} from '#design-diff/ast'
import { previewValue } from '#design-diff/report'
import type { SourceTree } from '#design-diff/source'
import type { Data, Evidence } from '#design-diff/types'

export function child(path: NodePath, name: string): NodePath {
  return path.get(name) as NodePath
}
export function children(path: NodePath, name: string): NodePath[] {
  return path.get(name) as NodePath[]
}
export function object(value: Data): value is Record<string, Data> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

interface Module {
  ast: t.File
  exports: Map<string, NodePath>
  stars: string[]
}

/** A bounded interpreter for data expressions. It never invokes a source function. */
export class Resolver {
  private readonly modules = new Map<string, Module>()
  private readonly values = new WeakMap<t.Node, Map<string, Evidence & { cost: number }>>()
  private readonly evaluations = new WeakMap<t.Node, Evidence>()
  private readonly unknowns = new WeakMap<t.Node, Map<string, Evidence>>()
  private readonly opaqueValues = new Map<string, Evidence>()
  private readonly resolvingUnknown = new Set<t.Node>()
  private steps = 0
  private readonly active = new Set<t.Node>()
  private dependencies = new Set<string>()
  private unresolved = new Set<string>()

  constructor(readonly tree: SourceTree) {}

  module(file: string): Module {
    const cached = this.modules.get(file)
    if (cached) {
      this.modules.delete(file)
      this.modules.set(file, cached)
      return cached
    }
    const source = this.tree.texts.get(file)
    if (source === undefined) throw new Error('Source unavailable')
    const ast = parseSource(source, file)
    const exports = new Map<string, NodePath>()
    const stars: string[] = []
    traverse(ast, {
      ExportDefaultDeclaration(p) {
        exports.set('default', child(p, 'declaration'))
      },
      ExportNamedDeclaration(p) {
        const declaration = child(p, 'declaration')
        if (declaration.isVariableDeclaration()) {
          for (const d of children(declaration, 'declarations'))
            exports.set(propertyName((d.node as t.VariableDeclarator).id), child(d, 'init'))
        } else if (declaration.isFunctionDeclaration() && declaration.node.id)
          exports.set(declaration.node.id.name, declaration)
        for (const specifier of children(p, 'specifiers')) {
          if (specifier.isExportSpecifier())
            exports.set(propertyName(specifier.node.exported), specifier)
        }
      },
      ExportAllDeclaration(p) {
        stars.push(p.node.source.value)
      },
    })
    const result = { ast, exports, stars }
    if (this.modules.size >= 128) this.modules.delete(this.modules.keys().next().value!)
    this.modules.set(file, result)
    return result
  }

  evaluate(path: NodePath, file: string): Evidence {
    const cached = this.evaluations.get(path.node)
    if (cached)
      return {
        ...cached,
        dependencies: [...cached.dependencies],
        unresolved: [...cached.unresolved],
      }
    this.currentFile = file
    this.steps = 0
    this.active.clear()
    this.resolvingUnknown.clear()
    this.dependencies = new Set([file])
    this.unresolved = new Set()
    const value = this.value(path, file, 0)
    const result = {
      value,
      dependencies: [...this.dependencies].sort(),
      unresolved: [...this.unresolved].sort(),
    }
    if (path.node) this.evaluations.set(path.node, result)
    return { ...result, dependencies: [...result.dependencies], unresolved: [...result.unresolved] }
  }

  /** Identify receiver provenance, rather than assuming a method name means DOM. */
  renderingCall(path: NodePath, file: string): boolean {
    const callee = child(path, 'callee')
    if (callee.isIdentifier()) {
      const binding = callee.scope.getBinding(callee.node.name)
      const declaration = binding?.path.parentPath
      const imported = binding?.path.isImportSpecifier()
        ? propertyName(binding.path.node.imported)
        : callee.node.name
      return (
        !!declaration?.isImportDeclaration() &&
        /^(?:react|react-dom)(?:\/|$)/.test(declaration.node.source.value) &&
        /^(?:createElement|createPortal)$/.test(imported)
      )
    }
    if (!callee.isMemberExpression()) return false
    const receiver = child(callee, 'object')
    const method = propertyName(callee.node.property)
    const provenance = (p: NodePath, seen = new Set<t.Node>()): string => {
      if (!p.node || seen.has(p.node)) return ''
      seen.add(p.node)
      if (p.isIdentifier()) {
        const binding = p.scope.getBinding(p.node.name)
        if (!binding)
          return ['document', 'window', 'React', 'ReactDOM', 'CSS'].includes(p.node.name)
            ? p.node.name
            : ''
        if (binding.path.isVariableDeclarator())
          return provenance(child(binding.path, 'init'), seen)
        if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier()) {
          const declaration = binding.path.parentPath
          return declaration.isImportDeclaration() ? declaration.node.source.value : ''
        }
        const annotation = binding.identifier.typeAnnotation
        return annotation ? JSON.stringify(annotation) : ''
      }
      if (p.isMemberExpression())
        return `${provenance(child(p, 'object'), seen)}.${propertyName(p.node.property)}`
      if (p.isCallExpression() || p.isNewExpression()) return provenance(child(p, 'callee'), seen)
      return ''
    }
    const origin = provenance(receiver)
    const knownMethod =
      /^(?:createElement|createPortal|createTextNode|appendChild|insertAdjacentHTML|insertRule|deleteRule|replaceSync|setAttribute|setProperty|animate|addColorStop|fillRect|strokeRect|drawImage|fillText|strokeText|getContext)$/.test(
        method
      )
    if (!knownMethod && !origin.includes('.getContext')) return false
    if (/opentelemetry|startSpan|startActiveSpan|tracer|Trace|Span/.test(origin)) return false
    if (origin.includes('.getContext')) return true
    if (
      /document|window|react-dom|^react$|HTML\w*Element|SVG\w*Element|Canvas|CSSStyle|CSS\.*/.test(
        origin
      )
    )
      return true
    // Canvas operations are specific; ambiguous DOM methods require a typed/ref receiver
    // or another established DOM operation in the same function.
    if (
      /^(?:fillRect|strokeRect|drawImage|fillText|strokeText|addColorStop|getContext)$/.test(method)
    )
      return true
    if (/^(?:setAttribute|setProperty|animate)$/.test(method)) {
      const owner = path.getFunctionParent()
      return (
        !!owner &&
        /(?:document\.(?:createElement|querySelector|getElementById)|\.getContext\(|useRef<[^>]*(?:Element|Canvas))/.test(
          this.tree.texts.get(file) ?? ''
        )
      )
    }
    return /^(?:createElement|createPortal|createTextNode|appendChild|insertAdjacentHTML|insertRule|deleteRule|replaceSync)$/.test(
      method
    )
  }

  /** Interpret the configured capability adapter using its declared environment fields. */
  private environmentAdapter(
    path: NodePath,
    adapter: NonNullable<SourceTree['config']['environmentAdapters']>[number],
    file: string,
    depth: number
  ): Data | undefined {
    const argument = children(path, 'arguments')[0]
    if (!argument?.isObjectExpression()) return undefined
    const definition = children(argument, 'properties').find(
      (property) => property.isObjectProperty() && propertyName(property.node.key) === 'definition'
    )
    if (!definition) return undefined
    const resolve = (
      path: NodePath,
      file: string,
      seen = new Set<t.Node>()
    ): { path: NodePath; file: string } | undefined => {
      if (!path.node || seen.has(path.node) || seen.size > 32) return undefined
      seen.add(path.node)
      if (path.isTSAsExpression() || path.isTSSatisfiesExpression())
        return resolve(child(path, 'expression'), file, seen)
      if (path.isIdentifier()) {
        const binding = path.scope.getBinding(path.node.name)
        if (binding?.constant && binding.path.isVariableDeclarator())
          return resolve(child(binding.path, 'init'), file, seen)
        if (binding?.path.isImportSpecifier()) {
          const declaration = binding.path.parentPath
          const target =
            declaration.isImportDeclaration() &&
            this.tree.resolve(file, declaration.node.source.value)
          const origin =
            target &&
            this.tree.graph?.resolvedExport(target, propertyName(binding.path.node.imported))
              ?.origin
          if (origin) {
            this.dependencies.add(origin.file)
            const exported = this.module(origin.file).exports.get(origin.exported)
            if (exported) return resolve(exported, origin.file, seen)
          }
        }
      }
      return { path, file }
    }
    const declared = resolve(child(definition, 'value'), file)
    if (!declared) return undefined
    let schema = declared.path
    if (schema.isCallExpression()) {
      const args = children(schema, 'arguments')
      if (args.length !== 1) return undefined
      schema = resolve(args[0], declared.file)?.path ?? args[0]
    }
    if (!schema.isObjectExpression()) return undefined
    const keys = new Set<string>()
    let dynamic = false
    schema.traverse({
      StringLiteral(p) {
        if (/^[A-Z][A-Z0-9_]+$/.test(p.node.value)) keys.add(p.node.value)
      },
      SpreadElement() {
        dynamic = true
      },
      ReferencedIdentifier(p) {
        if (p.parentPath.isCallExpression() && p.parentPath.node.callee === p.node) return
        dynamic = true
      },
    })
    if (dynamic || !keys.size) return undefined
    const environment = this.module(adapter.environmentModule).exports.get(
      adapter.environmentExport
    )
    if (!environment) return undefined
    const selected: Record<string, Data> = {}
    this.dependencies.add(adapter.environmentModule)
    this.dependencies.add(adapter.implementationModule)
    for (const key of [...keys].sort())
      selected[key] =
        this.selected(environment, key, adapter.environmentModule, 0) ??
        this.unknown(
          environment,
          'Configured environment field unavailable',
          adapter.environmentModule
        )
    const implementation = this.exported(
      adapter.implementationModule,
      adapter.implementationExport,
      0
    )
    this.unresolved.add(
      'Configured capability adapter: declared environment fields and provider factories are traced without execution'
    )
    return {
      $environmentAdapter: this.opaqueExports(adapter.module, adapter.export),
      implementation,
      environment: selected,
      arguments: children(path, 'arguments').map((argument) =>
        this.value(argument, file, depth + 1)
      ),
    }
  }

  private currentFile = ''

  /** Select a property before expanding siblings, including createEnv's schema convention. */
  private selected(
    path: NodePath,
    key: string,
    file: string,
    depth: number,
    seen = new Set<t.Node>()
  ): Data | undefined {
    if (!path?.node || seen.has(path.node) || depth > this.tree.config.limits.resolutionDepth)
      return undefined
    seen.add(path.node)
    if (path.isTSAsExpression() || path.isTSSatisfiesExpression() || path.isTSNonNullExpression())
      return this.selected(child(path, 'expression'), key, file, depth + 1, seen)
    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(path.node.name)
      if (binding?.constant && binding.path.isVariableDeclarator())
        return this.selected(child(binding.path, 'init'), key, file, depth + 1, seen)
      if (binding?.path.isImportSpecifier() || binding?.path.isImportDefaultSpecifier()) {
        const declaration = binding.path.parentPath
        if (declaration.isImportDeclaration()) {
          const target = this.tree.resolve(file, declaration.node.source.value)
          const name = binding.path.isImportSpecifier()
            ? propertyName(binding.path.node.imported)
            : 'default'
          const origin = target && this.tree.graph?.resolvedExport(target, name)?.origin
          if (origin) {
            this.dependencies.add(origin.file)
            const exported = this.module(origin.file).exports.get(origin.exported)
            if (exported) return this.selected(exported, key, origin.file, depth + 1, seen)
          }
        }
      }
    }
    if (path.isObjectExpression()) {
      for (const prop of children(path, 'properties').reverse()) {
        if (prop.isObjectMethod() && !prop.node.computed && propertyName(prop.node.key) === key)
          return this.functionValue(prop, file, depth + 1)
        if (prop.isObjectProperty() && !prop.node.computed && propertyName(prop.node.key) === key)
          return this.value(child(prop, 'value'), file, depth + 1)
        if (prop.isSpreadElement()) {
          const selected = this.selected(child(prop, 'argument'), key, file, depth + 1, seen)
          if (selected !== undefined) return selected
          return undefined // An unknown later spread can override an earlier property.
        }
      }
    }
    if (path.isCallExpression() && t.isIdentifier(path.node.callee)) {
      const binding = path.scope.getBinding(path.node.callee.name)
      const declaration = binding?.path.parentPath
      if (
        binding?.path.isImportSpecifier() &&
        propertyName(binding.path.node.imported) === 'createEnv' &&
        declaration?.isImportDeclaration() &&
        /^@t3-oss\/env-/.test(declaration.node.source.value)
      ) {
        const options = children(path, 'arguments')[0]
        if (!options?.isObjectExpression()) return undefined
        const selected: Record<string, Data> = {}
        for (const prop of children(options, 'properties')) {
          if (!prop.isObjectProperty()) continue
          const section = propertyName(prop.node.key)
          if (
            ['client', 'server', 'shared', 'runtimeEnv', 'experimental__runtimeEnv'].includes(
              section
            )
          ) {
            const value = this.selected(child(prop, 'value'), key, file, depth + 1, new Set(seen))
            if (value !== undefined) selected[section] = value
          }
        }
        return { $environment: key, definitions: selected }
      }
    }
    return undefined
  }

  /** A parameter describes its own destructured property/default, not its siblings. */
  private parameter(path: NodePath, name: string, file: string, depth: number): Data | undefined {
    const owner = path.isFunction() ? path : path.getFunctionParent()
    if (!owner) return undefined
    const locate = (p: NodePath, keys: Data[]): Data | undefined => {
      if (p.isIdentifier()) return p.node.name === name ? { $parameter: keys } : undefined
      if (p.isAssignmentPattern()) {
        const found = locate(child(p, 'left'), keys)
        return found === undefined
          ? undefined
          : { $default: this.value(child(p, 'right'), file, depth + 1), input: found }
      }
      if (p.isObjectPattern())
        for (const prop of children(p, 'properties')) {
          if (prop.isObjectProperty()) {
            const found = locate(child(prop, 'value'), [...keys, propertyName(prop.node.key)])
            if (found !== undefined) return found
          }
          if (prop.isRestElement() && t.isIdentifier(prop.node.argument, { name }))
            return {
              $parameterRest: keys,
              excluded: p.node.properties
                .filter(t.isObjectProperty)
                .map((prop) => propertyName(prop.key)),
            }
        }
      if (p.isArrayPattern())
        for (const [index, element] of children(p, 'elements').entries()) {
          const found = element.node && locate(element, [...keys, index])
          if (found !== undefined && found !== false) return found
        }
      return undefined
    }
    for (const [index, param] of children(owner, 'params').entries()) {
      const found = locate(param, [index])
      if (found !== undefined) return found
    }
    return undefined
  }

  private destructured(
    binding: NodePath<t.VariableDeclarator>,
    name: string,
    file: string,
    depth: number
  ): Data | undefined {
    const find = (
      pattern: NodePath,
      keys: Data[]
    ): { keys: Data[]; fallback?: NodePath } | undefined => {
      if (pattern.isIdentifier()) return pattern.node.name === name ? { keys } : undefined
      if (pattern.isAssignmentPattern()) {
        const found = find(child(pattern, 'left'), keys)
        return found && { ...found, fallback: child(pattern, 'right') }
      }
      if (pattern.isObjectPattern())
        for (const property of children(pattern, 'properties')) {
          if (property.isObjectProperty() && !property.node.computed) {
            const found = find(child(property, 'value'), [...keys, propertyName(property.node.key)])
            if (found) return found
          }
        }
      if (pattern.isArrayPattern())
        for (const [index, element] of children(pattern, 'elements').entries()) {
          if (!element.node) continue
          const found = find(element, [...keys, index])
          if (found) return found
        }
      return undefined
    }
    const selection = find(child(binding, 'id'), [])
    if (!selection) return undefined
    const init = child(binding, 'init')
    const [first, ...rest] = selection.keys
    let value = typeof first === 'string' ? this.selected(init, first, file, depth + 1) : undefined
    const keys = value === undefined ? selection.keys : rest
    if (value === undefined) value = this.value(init, file, depth + 1)
    for (const key of keys) {
      if (
        (object(value) || Array.isArray(value)) &&
        (typeof key === 'string' || typeof key === 'number') &&
        Object.hasOwn(value, key)
      )
        value = (value as Record<string, Data>)[String(key)]
      else {
        this.unresolved.add('Unresolved destructured property')
        value = { $member: value, key }
      }
    }
    return selection.fallback
      ? { input: value, $default: this.value(selection.fallback, file, depth + 1) }
      : value
  }

  /** Trace return values and their guards without invoking application functions. */
  private functionValue(path: NodePath, file: string, depth: number): Data {
    let renders = false
    t.traverseFast(path.node, (node) => {
      if (t.isJSXElement(node) || t.isJSXFragment(node)) renders = true
    })
    // JSX definitions are extracted at their own source. Expanding component bodies
    // again at every reference duplicates evidence and confuses refactors with prop changes.
    if (renders) return { $renderFunction: { file, symbol: symbolName(path) } }
    const body = child(path, 'body')
    if (!body.isBlockStatement())
      return {
        $function: previewValue([{ value: this.value(body, file, depth + 1), conditions: [] }]),
      }
    const returns: Data[] = []
    body.traverse({
      Function(p) {
        p.skip()
      },
      ReturnStatement: (p) => {
        const conditions: Data[] = []
        for (
          let parent: NodePath | null = p.parentPath;
          parent && parent !== path;
          parent = parent.parentPath
        ) {
          if (parent.isIfStatement() || parent.isConditionalExpression()) {
            const branch = (
              p.parentPath === parent ? p : p.findParent((node) => node.parentPath === parent)
            )?.key
            conditions.push({
              test: this.value(child(parent, 'test'), file, depth + 1),
              branch: branch === 'alternate' ? 'else' : 'then',
            })
          }
          if (parent.isSwitchCase() && parent.parentPath.isSwitchStatement())
            conditions.push({
              switch: this.value(child(parent.parentPath, 'discriminant'), file, depth + 1),
              case: this.value(child(parent, 'test'), file, depth + 1),
            })
        }
        returns.push({ value: this.value(child(p, 'argument'), file, depth + 1), conditions })
      },
    })
    this.unresolved.add('Function return paths are analyzed statically, not executed')
    return { $function: previewValue(returns) }
  }

  private opaqueNode(path: NodePath, file: string): Data {
    let renders = false
    t.traverseFast(path.node, (node) => {
      if (t.isJSXElement(node) || t.isJSXFragment(node)) renders = true
    })
    return renders
      ? { $renderFunction: { file, symbol: symbolName(path) } }
      : fingerprint(path.node)
  }

  /** Opaque export summaries are independent of expression budgets and parser cache eviction. */
  private opaqueExports(file: string, name: string): Data {
    const key = `${file}:${name}`
    const cached = this.opaqueValues.get(key)
    if (cached) {
      for (const file of cached.dependencies) this.dependencies.add(file)
      return cached.value
    }
    const dependencies = this.dependencies
    this.dependencies = new Set([file])
    const value = this.opaqueExportInner(file, name)
    this.opaqueValues.set(key, { value, dependencies: [...this.dependencies], unresolved: [] })
    for (const file of this.dependencies) dependencies.add(file)
    this.dependencies = dependencies
    return value
  }

  /** Follow export declarations only when normal evaluation is bounded or ambiguous. */
  private opaqueExportInner(file: string, name: string, seen = new Set<string>()): Data {
    const key = `${file}:${name}`
    this.dependencies.add(file)
    if (seen.has(key)) return { $cycle: key }
    seen.add(key)
    if (seen.size > 64)
      return { $unresolvedExport: key, blob: this.tree.entries.get(file)?.oid ?? null }
    try {
      const module = this.module(file)
      const exported = module.exports.get(name)
      if (exported) {
        if (exported.isExportSpecifier()) {
          const parent = exported.parentPath
          if (parent.isExportNamedDeclaration() && parent.node.source) {
            const target = this.tree.resolve(file, parent.node.source.value)
            if (target)
              return this.opaqueExportInner(target, propertyName(exported.node.local), seen)
          }
          const binding = exported.scope.getBinding(propertyName(exported.node.local))
          if (binding)
            return fingerprint(
              binding.path.isVariableDeclarator() ? binding.path.node.init : binding.path.node
            )
        }
        return this.opaqueNode(exported, file)
      }
      const values: Data[] = []
      if (name === '*')
        for (const member of [...module.exports.keys()].sort())
          values.push([member, this.opaqueExportInner(file, member, new Set(seen))])
      for (const specifier of module.stars) {
        const target = this.tree.resolve(file, specifier)
        if (target) values.push(this.opaqueExportInner(target, name, new Set(seen)))
      }
      return values.length
        ? values
        : { $unresolvedExport: key, blob: this.tree.entries.get(file)?.oid ?? null }
    } catch {
      return { $unresolvedExport: key, blob: this.tree.entries.get(file)?.oid ?? null }
    }
  }

  /** Retain opaque evidence only for bindings actually referenced by this expression. */
  private unknown(path: NodePath, reason: string, file = this.currentFile): Data {
    this.unresolved.add(reason)
    const cached = this.unknowns.get(path.node)?.get(reason)
    if (cached) {
      for (const file of cached.dependencies) this.dependencies.add(file)
      return cached.value
    }
    if (this.resolvingUnknown.has(path.node)) {
      this.unresolved.add('Unresolved input cycle')
      return { $cycle: fingerprint(path.node) }
    }
    this.resolvingUnknown.add(path.node)
    const dependencies = this.dependencies
    this.dependencies = new Set([file])
    const inputs = new Map<string, Data>()
    const inspect = (reference: NodePath) => {
      if (!reference.isReferencedIdentifier()) return
      const binding = reference.scope.getBinding(reference.node.name)
      if (!binding) return
      const bound = binding.path
      if (
        bound.isImportSpecifier() ||
        bound.isImportDefaultSpecifier() ||
        bound.isImportNamespaceSpecifier()
      ) {
        const declaration = bound.parentPath
        if (!declaration.isImportDeclaration()) return
        const target = this.tree.resolve(file, declaration.node.source.value)
        if (!target) return
        const name = bound.isImportSpecifier()
          ? propertyName(bound.node.imported)
          : bound.isImportDefaultSpecifier()
            ? 'default'
            : '*'
        this.dependencies.add(target)
        const member = reference.parentPath
        if (
          member?.isMemberExpression() &&
          member.node.object === reference.node &&
          (!member.node.computed ||
            t.isStringLiteral(member.node.property) ||
            t.isNumericLiteral(member.node.property))
        ) {
          const key = propertyName(member.node.property)
          const selected = this.selected(reference, key, file, 0)
          if (selected !== undefined) {
            inputs.set(`${target}:${name}.${key}`, selected)
            return
          }
        }
        const origin = this.tree.graph?.resolvedExport(target, name)?.origin
        inputs.set(
          `${target}:${name}`,
          origin
            ? this.opaqueExports(origin.file, origin.exported)
            : this.opaqueExports(target, name)
        )
      }
    }
    inspect(path)
    path.traverse({ ReferencedIdentifier: inspect })
    const value = {
      $unresolved: reason,
      syntax: path.node.type,
      fingerprint: fingerprint(path.node),
      inputs: Object.fromEntries(inputs),
    }
    const entries = this.unknowns.get(path.node) ?? new Map()
    entries.set(reason, { value, dependencies: [...this.dependencies], unresolved: [reason] })
    this.unknowns.set(path.node, entries)
    for (const file of this.dependencies) dependencies.add(file)
    this.dependencies = dependencies
    this.resolvingUnknown.delete(path.node)
    return value
  }

  /** Parse an MDX expression in the lexical scope of its ESM declarations. */
  documentExpression(imports: string, expression: string, file: string): Evidence {
    const ast = parseSource(
      `${imports}\nconst __design_diff_value = (${expression})`,
      `${file}.tsx`
    )
    let result: Evidence = {
      value: null,
      dependencies: [file],
      unresolved: ['MDX expression unavailable'],
    }
    traverse(ast, {
      VariableDeclarator: (p) => {
        if (t.isIdentifier(p.node.id, { name: '__design_diff_value' }))
          result = this.evaluate(child(p, 'init'), file)
      },
    })
    return result
  }

  private exported(file: string, name: string, depth: number, visited = new Set<string>()): Data {
    const key = `${file}:${name}`
    if (depth > this.tree.config.limits.resolutionDepth || visited.has(key)) {
      this.unresolved.add('Dependency cycle or resolution depth limit')
      return { $unresolved: key }
    }
    visited.add(key)
    this.dependencies.add(file)
    try {
      if (file.endsWith('.json') && name === 'default')
        return canonicalJson(JSON.parse(this.tree.texts.get(file) ?? 'null'))
      const resolved = this.tree.graph?.resolvedExport(file, name)
      if (resolved) {
        for (const route of resolved.routes) this.dependencies.add(route)
        if (resolved.uncertain) {
          this.unresolved.add('Ambiguous, cyclic or unsupported re-export')
          return { $unresolved: key }
        }
        if (!resolved.origin) return { $missing: key }
        if (resolved.origin.file !== file)
          return this.exported(resolved.origin.file, resolved.origin.exported, depth + 1, visited)
      }
      const module = this.module(file)
      const exported = module.exports.get(name)
      if (exported) {
        if (exported.isExportSpecifier()) {
          const parent = exported.parentPath
          if (parent.isExportNamedDeclaration() && parent.node.source) {
            const target = this.tree.resolve(file, parent.node.source.value)
            if (target)
              return this.exported(target, propertyName(exported.node.local), depth + 1, visited)
          }
          return this.value(child(exported, 'local'), file, depth + 1)
        }
        return this.value(exported, file, depth + 1)
      }
      const candidates = module.stars
        .map((specifier) => this.tree.resolve(file, specifier))
        .filter((target): target is string => !!target && this.hasExport(target, name, new Set()))
      if (candidates.length === 1) return this.exported(candidates[0], name, depth + 1, visited)
      if (candidates.length > 1) this.unresolved.add('Ambiguous re-export')
    } catch {
      this.unresolved.add('Imported source could not be parsed')
    }
    return { $missing: key }
  }

  private hasExport(file: string, name: string, visited: Set<string>): boolean {
    if (visited.has(file) || visited.size > this.tree.config.limits.resolutionDepth) return false
    visited.add(file)
    const module = this.module(file)
    if (module.exports.has(name)) return true
    return module.stars.some((specifier) => {
      const target = this.tree.resolve(file, specifier)
      return target ? this.hasExport(target, name, new Set(visited)) : false
    })
  }

  private value(path: NodePath, file: string, depth: number): Data {
    if (!path?.node) return null
    const started = this.steps
    const cacheKey = `${depth}:${this.tree.config.limits.resolutionSteps - started}`
    const cached = this.values.get(path.node)?.get(cacheKey)
    if (cached && !this.active.has(path.node)) {
      this.steps += cached.cost
      for (const file of cached.dependencies) this.dependencies.add(file)
      for (const reason of cached.unresolved) this.unresolved.add(reason)
      return cached.value
    }
    if (
      ++this.steps > this.tree.config.limits.resolutionSteps ||
      depth > this.tree.config.limits.resolutionDepth
    )
      return this.unknown(path, 'Resolution budget exceeded', file)
    if (this.active.has(path.node)) return this.unknown(path, 'Dependency cycle', file)
    this.active.add(path.node)
    const previousFile = this.currentFile
    this.currentFile = file
    const dependencies = this.dependencies
    const unresolved = this.unresolved
    this.dependencies = new Set([file])
    this.unresolved = new Set()
    try {
      const value = this.inner(path, file, depth)
      if (![...this.unresolved].some((reason) => /cycle/i.test(reason))) {
        const entries = this.values.get(path.node) ?? new Map()
        // Bound per-node cache variants; budget/depth are part of the key so warming
        // a cache cannot change evidence in a later evaluation.
        if (entries.size < 8)
          entries.set(cacheKey, {
            value,
            cost: this.steps - started,
            dependencies: [...this.dependencies],
            unresolved: [...this.unresolved],
          })
        this.values.set(path.node, entries)
      }
      return value
    } finally {
      for (const file of this.dependencies) dependencies.add(file)
      for (const reason of this.unresolved) unresolved.add(reason)
      this.dependencies = dependencies
      this.unresolved = unresolved
      this.active.delete(path.node)
      this.currentFile = previousFile
    }
  }

  private inner(path: NodePath, file: string, depth: number): Data {
    const node = path.node
    const read = (key: string) => this.value(child(path, key), file, depth + 1)
    const readList = (key: string) => children(path, key).map((p) => this.value(p, file, depth + 1))
    if (t.isJSXElement(node) || t.isJSXFragment(node)) {
      const attributes: Data[] = []
      let tag: Data = 'fragment'
      if (path.isJSXElement()) {
        const opening = child(path, 'openingElement')
        tag = propertyName(path.node.openingElement.name)
        for (const attribute of children(opening, 'attributes')) {
          if (attribute.isJSXAttribute()) {
            const name = propertyName(attribute.node.name)
            if (/^(?:key|ref|on[A-Z].*)$/.test(name)) continue
            attributes.push([
              name,
              attribute.node.value ? this.value(child(attribute, 'value'), file, depth + 1) : true,
            ])
          } else if (attribute.isJSXSpreadAttribute())
            attributes.push({ spread: this.value(child(attribute, 'argument'), file, depth + 1) })
        }
      }
      return { $jsx: tag, attributes, children: readList('children') }
    }
    if (t.isJSXEmptyExpression(node)) return null
    if (t.isJSXText(node)) return jsxText(node.value)
    if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
      return node.value
    if (t.isNullLiteral(node)) return null
    if (
      t.isTSAsExpression(node) ||
      t.isTSSatisfiesExpression(node) ||
      t.isTSNonNullExpression(node) ||
      t.isParenthesizedExpression(node)
    )
      return read('expression')
    if (t.isIdentifier(node)) {
      if (node.name === 'undefined') return null
      const binding = path.scope.getBinding(node.name)
      if (!binding) {
        this.unresolved.add('Runtime binding')
        return { $runtime: node.name }
      }
      if (!binding.constant) {
        this.unresolved.add('Mutable binding')
        return {
          $mutable: fingerprint(binding.path.node),
          writes: binding.constantViolations.map((violation) => fingerprint(violation.node)),
        }
      }
      const bound = binding.path
      const parameter = this.parameter(bound, node.name, file, depth)
      if (parameter !== undefined) return parameter
      if (bound.isFunctionDeclaration()) return this.functionValue(bound, file, depth + 1)
      if (bound.isVariableDeclarator() && t.isIdentifier(bound.node.id))
        return this.value(child(bound, 'init'), file, depth + 1)
      if (bound.isVariableDeclarator()) {
        const selected = this.destructured(bound, node.name, file, depth + 1)
        if (selected !== undefined) return selected
      }
      if (
        bound.isImportSpecifier() ||
        bound.isImportDefaultSpecifier() ||
        bound.isImportNamespaceSpecifier()
      ) {
        const declaration = bound.parentPath
        if (!declaration.isImportDeclaration()) return this.unknown(path, 'Unsupported import')
        const target = this.tree.resolve(file, declaration.node.source.value)
        if (!target) {
          this.unresolved.add(`External import: ${declaration.node.source.value}`)
          return {
            $external: declaration.node.source.value,
            name: bound.isImportSpecifier() ? propertyName(bound.node.imported) : 'default',
          }
        }
        this.dependencies.add(target)
        if (bound.isImportNamespaceSpecifier()) return { $namespace: target }
        const result = this.exported(
          target,
          bound.isImportDefaultSpecifier() ? 'default' : propertyName(bound.node.imported),
          depth + 1
        )
        if (object(result) && '$missing' in result) this.unresolved.add('Unresolved export')
        return result
      }
      return this.unknown(bound, 'Runtime binding')
    }
    if (t.isObjectExpression(node)) {
      const result: Record<string, Data> = Object.create(null)
      for (const p of children(path, 'properties')) {
        if (p.isSpreadElement()) {
          const spread = this.value(child(p, 'argument'), file, depth + 1)
          if (object(spread) && !('$unresolved' in spread)) Object.assign(result, spread)
          else {
            result.$spread = spread
            this.unresolved.add('Unresolved object spread')
          }
        } else if (p.isObjectProperty()) {
          const key = p.node.computed
            ? this.value(child(p, 'key'), file, depth + 1)
            : propertyName(p.node.key)
          if (typeof key !== 'string' && typeof key !== 'number')
            return this.unknown(path, 'Computed property')
          result[String(key)] = this.value(child(p, 'value'), file, depth + 1)
        } else if (p.isObjectMethod() && !p.node.computed) {
          result[propertyName(p.node.key)] = this.functionValue(p, file, depth + 1)
        } else return this.unknown(path, 'Object method')
      }
      return result
    }
    if (t.isArrayExpression(node)) return readList('elements')
    if (t.isTemplateLiteral(node)) {
      const values = readList('expressions')
      if (values.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)))
        return node.quasis
          .map(
            (q, i) => (q.value.cooked ?? q.value.raw) + (i < values.length ? String(values[i]) : '')
          )
          .join('')
      return { $template: node.quasis.map((q) => q.value.cooked ?? q.value.raw), values }
    }
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      const key = node.computed ? read('property') : propertyName(node.property)
      const selected =
        typeof key === 'string'
          ? this.selected(child(path, 'object'), key, file, depth + 1)
          : undefined
      if (selected !== undefined) return selected
      const base = read('object')
      if (object(base) && typeof base.$namespace === 'string') {
        if (typeof key === 'string') return this.exported(base.$namespace, key, depth + 1)
        return this.unknown(path, 'Computed namespace property is unresolved')
      }
      if (
        (object(base) || Array.isArray(base)) &&
        (typeof key === 'string' || typeof key === 'number')
      ) {
        if (Object.hasOwn(base, key)) return (base as Record<string, Data>)[String(key)]
      }
      this.unresolved.add('Unresolved property')
      return { $member: base, key }
    }
    if (t.isUnaryExpression(node) && ['-', '+', '!'].includes(node.operator)) {
      const value = read('argument')
      if (typeof value === 'number' && node.operator !== '!')
        return node.operator === '-' ? -value : value
      if (typeof value === 'boolean' && node.operator === '!') return !value
      this.unresolved.add('Computed unary value')
      return { $unary: node.operator, argument: value }
    }
    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
      const left = read('left')
      const right = read('right')
      if (
        node.operator === '+' &&
        (typeof left === 'string' || typeof left === 'number') &&
        (typeof right === 'string' || typeof right === 'number')
      )
        return typeof left === 'string' || typeof right === 'string'
          ? String(left) + String(right)
          : left + right
      if (
        typeof left === 'number' &&
        typeof right === 'number' &&
        ['-', '*', '/'].includes(node.operator)
      ) {
        const value =
          node.operator === '-' ? left - right : node.operator === '*' ? left * right : left / right
        if (Number.isFinite(value)) return value
      }
      if (node.operator === '&&' && typeof left === 'boolean') return left ? right : false
      if (node.operator === '||' && typeof left === 'boolean') return left ? true : right
      this.unresolved.add('Conditional or computed value')
      return { $operator: node.operator, left, right }
    }
    if (t.isConditionalExpression(node)) {
      const test = read('test')
      if (typeof test === 'boolean') return test ? read('consequent') : read('alternate')
      return { $condition: test, then: read('consequent'), else: read('alternate') }
    }
    if (t.isFunction(node)) return this.functionValue(path, file, depth)
    if (t.isNewExpression(node)) return { $new: read('callee'), arguments: readList('arguments') }
    if (t.isTaggedTemplateExpression(node)) return { $tag: read('tag'), template: read('quasi') }
    if (t.isAwaitExpression(node)) return { $await: read('argument') }
    if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
      const localName = propertyName(node.callee)
      const binding = t.isIdentifier(node.callee) ? path.scope.getBinding(localName) : undefined
      const name = binding?.path.isImportSpecifier()
        ? propertyName(binding.path.node.imported)
        : localName
      const imported = binding?.path.isImportSpecifier() || binding?.path.isImportDefaultSpecifier()
      const declaration = imported ? binding?.path.parentPath : undefined
      const specifier = declaration?.isImportDeclaration() ? declaration.node.source.value : ''
      const helperFile = this.tree.resolve(file, specifier)
      if (helperFile) this.dependencies.add(helperFile)
      const adapter = this.tree.config.environmentAdapters?.find(
        (entry) => entry.module === helperFile && entry.export === name
      )
      if (adapter && imported) {
        const projected = this.environmentAdapter(path, adapter, file, depth)
        if (projected !== undefined) return projected
      }
      const classHelper =
        this.tree.config.classModules.includes(specifier) ||
        helperFile === 'packages/emcn/src/lib/cn.ts'
      const args = readList('arguments')
      if (imported && classHelper && this.tree.config.classFunctions.includes(name)) {
        const flatten = (data: Data): string | undefined => {
          if (typeof data === 'string' || typeof data === 'number') return String(data)
          if (data === false || data === null) return ''
          if (Array.isArray(data)) {
            const parts = data.map(flatten)
            return parts.every((v) => v !== undefined) ? parts.filter(Boolean).join(' ') : undefined
          }
          if (object(data) && Object.values(data).every((v) => typeof v === 'boolean'))
            return Object.keys(data)
              .filter((key) => data[key])
              .join(' ')
          return undefined
        }
        const classes = flatten(args)
        return { $classes: classes ?? args, composition: name }
      }
      if (
        imported &&
        this.tree.config.variantModules.includes(specifier) &&
        this.tree.config.variantFunctions.includes(name)
      )
        return { $cva: args }
      const callee = read('callee')
      if (object(callee) && Array.isArray(callee.$cva)) {
        const [base, options] = callee.$cva
        const selection = args[0] ?? {}
        if (
          typeof base === 'string' &&
          object(options) &&
          object(selection) &&
          Object.values(selection).every(
            (value) => value === null || ['string', 'boolean', 'number'].includes(typeof value)
          )
        ) {
          const variants = object(options.variants) ? options.variants : {}
          const defaults = object(options.defaultVariants) ? options.defaultVariants : {}
          const selected = { ...defaults, ...selection }
          const classes: Data[] = [base]
          for (const [variant, choices] of Object.entries(variants)) {
            if (object(choices) && selected[variant] !== null)
              classes.push(choices[String(selected[variant])] ?? null)
          }
          if (Array.isArray(options.compoundVariants)) {
            for (const compound of options.compoundVariants) {
              if (!object(compound)) continue
              if (
                Object.entries(compound).every(
                  ([key, value]) =>
                    ['class', 'className'].includes(key) ||
                    (Array.isArray(value) ? value.includes(selected[key]) : value === selected[key])
                )
              )
                classes.push(compound.class ?? compound.className ?? null)
            }
          }
          classes.push(selection.class ?? null, selection.className ?? null)
          if (classes.every((value) => value === null || typeof value === 'string'))
            return { $classes: classes.filter(Boolean).join(' '), composition: 'cva' }
        }
        this.unresolved.add('Runtime or unsupported CVA selection')
        return { $variant: callee, selection: args }
      }
      this.unresolved.add('Function call is not executed')
      return { $call: callee, arguments: args }
    }
    if (t.isUnaryExpression(node)) return { $unary: node.operator, argument: read('argument') }
    if (t.isRegExpLiteral(node)) return { $regexp: node.pattern, flags: node.flags }
    if (t.isSequenceExpression(node)) return { $sequence: readList('expressions') }
    if (t.isJSXExpressionContainer(node)) return read('expression')
    return this.unknown(path, 'Unsupported expression')
  }
}
