import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { canonical, fingerprint, parseSource, propertyName, traverse } from '#design-diff/ast'
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
  private steps = 0
  private readonly active = new Set<t.Node>()
  private dependencies = new Set<string>()
  private unresolved = new Set<string>()

  constructor(readonly tree: SourceTree) {}

  module(file: string): Module {
    const cached = this.modules.get(file)
    if (cached) return cached
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
    this.modules.set(file, result)
    return result
  }

  evaluate(path: NodePath, file: string): Evidence {
    this.steps = 0
    this.active.clear()
    this.dependencies = new Set([file])
    this.unresolved = new Set()
    const value = this.value(path, file, 0)
    return {
      value,
      dependencies: [...this.dependencies].sort(),
      unresolved: [...this.unresolved].sort(),
    }
  }

  private unknown(path: NodePath, reason: string): Data {
    this.unresolved.add(reason)
    return {
      $unresolved: reason,
      syntax: path.node.type,
      symbol: propertyName(path.node),
      fingerprint: fingerprint(path.node),
    }
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
        return canonical(JSON.parse(this.tree.texts.get(file) ?? 'null'))
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
    if (
      ++this.steps > this.tree.config.limits.resolutionSteps ||
      depth > this.tree.config.limits.resolutionDepth
    )
      return this.unknown(path, 'Resolution budget exceeded')
    if (this.active.has(path.node)) return this.unknown(path, 'Dependency cycle')
    this.active.add(path.node)
    try {
      return this.inner(path, file, depth)
    } finally {
      this.active.delete(path.node)
    }
  }

  private inner(path: NodePath, file: string, depth: number): Data {
    const node = path.node
    const read = (key: string) => this.value(child(path, key), file, depth + 1)
    const readList = (key: string) => children(path, key).map((p) => this.value(p, file, depth + 1))
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
      if (!binding) return this.unknown(path, 'Runtime binding')
      if (!binding.constant) {
        this.unresolved.add('Mutable binding')
        return {
          $mutable: fingerprint(binding.path.node),
          writes: binding.constantViolations.map((violation) => fingerprint(violation.node)),
        }
      }
      const bound = binding.path
      if (bound.isVariableDeclarator() && t.isIdentifier(bound.node.id))
        return this.value(child(bound, 'init'), file, depth + 1)
      if (
        bound.isImportSpecifier() ||
        bound.isImportDefaultSpecifier() ||
        bound.isImportNamespaceSpecifier()
      ) {
        const declaration = bound.parentPath
        if (!declaration.isImportDeclaration()) return this.unknown(path, 'Unsupported import')
        const target = this.tree.resolve(file, declaration.node.source.value)
        if (!target) return this.unknown(path, `External import: ${declaration.node.source.value}`)
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
      const base = read('object')
      const key = node.computed ? read('property') : propertyName(node.property)
      if (object(base) && typeof base.$namespace === 'string' && typeof key === 'string')
        return this.exported(base.$namespace, key, depth + 1)
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
    if (t.isCallExpression(node)) {
      const name = propertyName(node.callee)
      const binding = t.isIdentifier(node.callee) ? path.scope.getBinding(name) : undefined
      const imported = binding?.path.isImportSpecifier() || binding?.path.isImportDefaultSpecifier()
      const declaration = imported ? binding?.path.parentPath : undefined
      const specifier = declaration?.isImportDeclaration() ? declaration.node.source.value : ''
      const helperFile = this.tree.resolve(file, specifier)
      if (helperFile) this.dependencies.add(helperFile)
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
    if (t.isJSXExpressionContainer(node)) return read('expression')
    return this.unknown(path, 'Unsupported expression')
  }
}
