import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { fingerprint, location, parseSyntax, propertyName, traverse } from '#design-diff/ast'
import { environmentFields } from '#design-diff/environment'
import { finiteKeys } from '#design-diff/finite'
import { reclaimMemory } from '#design-diff/memory'
import { Resolver } from '#design-diff/resolve'
import type { SourceTree } from '#design-diff/source'
import type { Location } from '#design-diff/types'

interface ExportTarget {
  source?: string
  name: string
}
interface Module {
  exports: Map<string, ExportTarget>
  stars: string[]
  imports: Map<string, ExportTarget>
  barrel: boolean
  effects?: string
}
/** Parsed import/export facts contain no AST or revision-specific resolved paths. */
const moduleSnapshots = new Map<string, { module: Module; specifiers: string[] }>()

interface BindingFacts {
  values: Map<string, string>
  reverse: Map<string, Set<string>>
  unowned: Set<string>
  effects: string
  members: Map<string, { keys?: string[]; owners?: string[] }[]>
}

interface Origin {
  file: string
  symbol: string
  exported: string
}
interface Trace {
  origins: Origin[]
  routes: string[]
  uncertain: boolean
}
export interface Usage {
  location: Location
  symbol: string
  kind: 'jsx' | 'call' | 'reference'
}
interface Reference {
  origin: Origin
  usage: Usage
}

/** Named imports bypass export-only indexes; unsupported imports retain conservative file edges. */
export class DependencyGraph {
  readonly dependencies = new Map<string, Set<string>>()
  readonly references: Reference[] = []
  readonly limitations = new Map<string, Set<string>>()
  private readonly modules = new Map<string, Module>()
  private readonly raw = new Map<string, Set<string>>()
  private readonly traces = new Map<string, Trace>()
  private readonly watches = new Map<string, Map<string, Set<string>>>()
  private readonly edgeSymbols = new Map<string, Set<string>>()
  private readonly counted = new Set<string>()
  private readonly bindingSnapshots = new Map<string, BindingFacts | undefined>()

  constructor(
    readonly tree: SourceTree,
    private readonly script: RegExp,
    private readonly asset: RegExp
  ) {
    let parsed = 0
    for (const [file, source] of tree.texts) {
      if (++parsed % 128 === 0) reclaimMemory()
      const raw = new Set<string>()
      this.raw.set(file, raw)
      this.dependencies.set(file, new Set())
      if (!this.script.test(file)) {
        for (const match of source.matchAll(
          /(?:from\s*|import\s*|@import\s*|url\(\s*)["']([^"']+)["']/g
        )) {
          const target = tree.resolve(file, match[1])
          if (target) raw.add(target)
        }
        continue
      }
      const cacheKey = `${tree.entries.get(file)?.oid}:${this.asset.source}`
      const cached = moduleSnapshots.get(cacheKey)
      if (cached) {
        this.modules.set(file, cached.module)
        for (const specifier of cached.specifiers) {
          const target = tree.resolve(file, specifier)
          if (target) raw.add(target)
        }
        continue
      }
      const specifiers = new Set<string>()
      const addSpecifier = (specifier: string) => {
        specifiers.add(specifier)
        const target = tree.resolve(file, specifier)
        if (target) raw.add(target)
      }
      try {
        const ast = parseSyntax(source, file)
        const exports = new Map<string, ExportTarget>()
        const imports = new Map<string, ExportTarget>()
        const stars: string[] = []
        let barrel = ast.program.body.length > 0
        for (const node of ast.program.body) {
          if (t.isImportDeclaration(node)) {
            if (node.importKind === 'type') continue
            addSpecifier(node.source.value)
            if (!node.specifiers.length) barrel = false
            for (const specifier of node.specifiers) {
              if (t.isImportSpecifier(specifier) && specifier.importKind === 'type') continue
              imports.set(specifier.local.name, {
                source: node.source.value,
                name: t.isImportSpecifier(specifier)
                  ? propertyName(specifier.imported)
                  : t.isImportDefaultSpecifier(specifier)
                    ? 'default'
                    : '*',
              })
            }
          } else if (t.isExportAllDeclaration(node)) {
            if (node.exportKind === 'type') continue
            stars.push(node.source.value)
            addSpecifier(node.source.value)
          } else if (t.isExportNamedDeclaration(node)) {
            if (node.exportKind === 'type') continue
            if (node.declaration) {
              if (
                t.isTSInterfaceDeclaration(node.declaration) ||
                t.isTSTypeAliasDeclaration(node.declaration)
              )
                continue
              barrel = false
              if (t.isVariableDeclaration(node.declaration)) {
                for (const declaration of node.declaration.declarations)
                  for (const name of Object.keys(t.getBindingIdentifiers(declaration.id)))
                    exports.set(name, { name })
              } else if ('id' in node.declaration && t.isIdentifier(node.declaration.id))
                exports.set(node.declaration.id.name, { name: node.declaration.id.name })
            }
            if (node.source) {
              addSpecifier(node.source.value)
            }
            for (const specifier of node.specifiers) {
              if (t.isExportSpecifier(specifier) && specifier.exportKind !== 'type') {
                exports.set(propertyName(specifier.exported), {
                  source: node.source?.value,
                  name: propertyName(specifier.local),
                })
              } else if (t.isExportNamespaceSpecifier(specifier)) {
                exports.set(propertyName(specifier.exported), {
                  source: node.source?.value,
                  name: '*',
                })
              }
            }
          } else if (t.isExportDefaultDeclaration(node)) {
            barrel = false
            exports.set('default', {
              name: t.isIdentifier(node.declaration)
                ? node.declaration.name
                : 'id' in node.declaration && node.declaration.id
                  ? node.declaration.id.name
                  : 'default',
            })
          } else if (
            !t.isTSInterfaceDeclaration(node) &&
            !t.isTSTypeAliasDeclaration(node) &&
            !t.isEmptyStatement(node)
          )
            barrel = false
        }
        t.traverseFast(ast, (node) => {
          const specifier =
            t.isCallExpression(node) &&
            (t.isImport(node.callee) || t.isIdentifier(node.callee, { name: 'require' })) &&
            t.isStringLiteral(node.arguments[0])
              ? node.arguments[0].value
              : t.isStringLiteral(node) && this.asset.test(node.value)
                ? node.value
                : undefined
          if (specifier) addSpecifier(specifier)
        })
        const effects = [
          ...ast.program.directives,
          ...ast.program.body.filter(
            (node) =>
              t.isExpressionStatement(node) ||
              (t.isImportDeclaration(node) && node.importKind !== 'type' && !node.specifiers.length)
          ),
        ]
        const module = {
          exports,
          stars,
          imports,
          barrel,
          effects: effects.length ? fingerprint(effects) : undefined,
        }
        this.modules.set(file, module)
        if (moduleSnapshots.size >= 32768)
          moduleSnapshots.delete(moduleSnapshots.keys().next().value!)
        moduleSnapshots.set(cacheKey, { module, specifiers: [...specifiers] })
      } catch {
        tree.failures.add(file)
      }
    }
    for (const [file] of tree.texts) {
      this.connect(file)
      if (++parsed % 128 === 0) reclaimMemory()
    }
    reclaimMemory()
  }

  private note(file: string, message: string) {
    const notes = this.limitations.get(file) ?? new Set<string>()
    notes.add(message)
    this.limitations.set(file, notes)
  }

  private trace(
    file: string,
    name: string,
    active = new Set<string>(),
    budget = { remaining: this.tree.config.limits.resolutionSteps }
  ): Trace {
    const key = `${file}\0${name}`
    const cached = this.traces.get(key)
    if (cached) return cached
    if (
      --budget.remaining < 0 ||
      active.has(key) ||
      active.size >= this.tree.config.limits.resolutionDepth
    )
      return { origins: [], routes: [file], uncertain: true }
    const module = this.modules.get(file)
    if (!module)
      return {
        origins:
          file.endsWith('.json') && name === 'default'
            ? [{ file, symbol: name, exported: name }]
            : [],
        routes: [file],
        uncertain: !file.endsWith('.json'),
      }
    const next = new Set([...active, key])
    const follow = (source: string, exported: string): Trace => {
      const target = this.tree.resolve(file, source)
      return target
        ? this.trace(target, exported, next, budget)
        : { origins: [], routes: [], uncertain: true }
    }
    const target = module.exports.get(name)
    let result: Trace
    if (name === '*') return { origins: [], routes: [file], uncertain: true }
    if (target) {
      const imported = target.source ? undefined : module.imports.get(target.name)
      if (target.source) result = follow(target.source, target.name)
      else if (imported?.source) result = follow(imported.source, imported.name)
      else
        result = {
          origins: [{ file, symbol: target.name, exported: name }],
          routes: [],
          uncertain: false,
        }
    } else if (name === 'default') result = { origins: [], routes: [], uncertain: false }
    else {
      const results = module.stars.map((source) => follow(source, name))
      const origins = [
        ...new Map(
          results
            .flatMap((item) => item.origins)
            .map((origin) => [`${origin.file}\0${origin.symbol}`, origin])
        ).values(),
      ]
      result = {
        origins,
        routes: results
          .filter((item) => item.origins.length || item.uncertain)
          .flatMap((item) => item.routes),
        uncertain: origins.length > 1 || results.some((item) => item.uncertain),
      }
    }
    result = { ...result, routes: [...new Set([file, ...result.routes])].sort() }
    if (!result.uncertain) this.traces.set(key, result)
    return result
  }

  /** Reuses the bounded export index without parsing unrelated re-export targets again. */
  resolvedExport(file: string, name: string) {
    const trace = this.trace(file, name)
    return {
      origin: !trace.uncertain && trace.origins.length === 1 ? trace.origins[0] : undefined,
      routes: trace.routes,
      uncertain: trace.uncertain,
    }
  }

  private add(file: string, specifier: string, name: string) {
    const target = this.tree.resolve(file, specifier)
    if (!target) return
    const trace = this.trace(target, name)
    const precise = !trace.uncertain && trace.origins.length === 1
    const dependencies = this.dependencies.get(file) as Set<string>
    const edge = (target: string, symbol: string) => {
      dependencies.add(target)
      const key = `${file}\0${target}`
      const symbols = this.edgeSymbols.get(key) ?? new Set<string>()
      symbols.add(symbol)
      this.edgeSymbols.set(key, symbols)
    }
    if (precise) {
      for (const origin of trace.origins) edge(origin.file, origin.symbol)
      for (const route of trace.routes) {
        if (trace.origins.some((origin) => origin.file === route)) continue
        const watchers = this.watches.get(route) ?? new Map<string, Set<string>>()
        const signatures = watchers.get(file) ?? new Set<string>()
        signatures.add(
          JSON.stringify([
            specifier,
            name,
            trace.origins,
            trace.routes.map((route) => this.modules.get(route)?.effects ?? null),
          ])
        )
        watchers.set(file, signatures)
        this.watches.set(route, watchers)
      }
    } else {
      edge(target, '*')
      if (this.script.test(target))
        this.note(
          file,
          'Import usage is unresolved; potential consumers use conservative file dependencies'
        )
    }
  }

  private connect(file: string) {
    const module = this.modules.get(file)
    if (!module) {
      for (const target of this.raw.get(file) ?? [])
        (this.dependencies.get(file) as Set<string>).add(target)
      return
    }
    if (module.barrel) {
      for (const target of this.raw.get(file) ?? []) this.dependencies.get(file)!.add(target)
      return
    }
    const ast = parseSyntax(this.tree.texts.get(file) as string, file)
    const namespaces = new Map([...module.imports].filter(([, target]) => target.name === '*'))
    const referenced = new Set<string>()
    traverse(ast, {
      noScope: true,
      ImportDeclaration: (p) => {
        if (p.node.importKind === 'type') return
        if (!p.node.specifiers.length) this.add(file, p.node.source.value, '*')
        for (const specifier of p.node.specifiers) {
          if (t.isImportSpecifier(specifier) && specifier.importKind === 'type') continue
          if (!t.isImportNamespaceSpecifier(specifier))
            this.add(
              file,
              p.node.source.value,
              t.isImportDefaultSpecifier(specifier) ? 'default' : propertyName(specifier.imported)
            )
        }
      },
      ReferencedIdentifier: (p) => {
        const name = propertyName(p.node)
        const namespace = namespaces.get(name)
        if (!namespace?.source || p.findParent((parent) => parent.isTSType())) return
        referenced.add(name)
        this.add(file, namespace.source, this.namespaceMember(p))
      },
      ExportNamedDeclaration: (p) => {
        if (p.node.exportKind === 'type' || !p.node.source) return
        for (const specifier of p.node.specifiers)
          if (t.isExportSpecifier(specifier) && specifier.exportKind !== 'type')
            this.add(file, p.node.source.value, propertyName(specifier.local))
      },
      ExportAllDeclaration: (p) => {
        if (p.node.exportKind !== 'type') this.add(file, p.node.source.value, '*')
      },
      CallExpression: (p) => {
        if (
          (t.isImport(p.node.callee) || t.isIdentifier(p.node.callee, { name: 'require' })) &&
          t.isStringLiteral(p.node.arguments[0])
        )
          this.add(file, p.node.arguments[0].value, '*')
      },
      StringLiteral: (p) => {
        if (!this.asset.test(p.node.value)) return
        const target = this.tree.resolve(file, p.node.value)
        if (target) (this.dependencies.get(file) as Set<string>).add(target)
      },
    })
    for (const [name, target] of namespaces)
      if (!referenced.has(name) && target.source) this.add(file, target.source, '*')
  }

  private namespaceMember(reference: NodePath): string {
    const parent = reference.parentPath
    if (parent?.isMemberExpression() && reference.key === 'object')
      return !parent.node.computed || t.isStringLiteral(parent.node.property)
        ? propertyName(parent.node.property)
        : '*'
    return parent?.isJSXMemberExpression() && reference.key === 'object'
      ? propertyName(parent.node.property)
      : '*'
  }

  /** Build binding scopes only for candidate usage files, not every module in the repository. */
  private count(file: string) {
    if (this.counted.has(file) || this.modules.get(file)?.barrel) return
    this.counted.add(file)
    const ast = parseSyntax(this.tree.texts.get(file) as string, file)
    const record = (specifier: string, name: string, references: NodePath[]) => {
      const target = this.tree.resolve(file, specifier)
      if (!target) return
      const trace = this.trace(target, name)
      if (trace.uncertain || trace.origins.length !== 1) return
      for (const reference of references) {
        if (
          reference.findParent(
            (parent) =>
              parent.isTSType() || parent.isExportSpecifier() || parent.isJSXClosingElement()
          )
        )
          continue
        this.references.push({
          origin: trace.origins[0],
          usage: {
            location: location(file, reference.node),
            symbol: trace.origins[0].symbol,
            kind: reference.findParent((parent) => parent.isJSXOpeningElement())
              ? 'jsx'
              : reference.parentPath?.isCallExpression() && reference.key === 'callee'
                ? 'call'
                : 'reference',
          },
        })
      }
    }
    traverse(ast, {
      ImportDeclaration: (p) => {
        if (p.node.importKind === 'type') return
        for (const specifier of p.node.specifiers) {
          if (t.isImportSpecifier(specifier) && specifier.importKind === 'type') continue
          const references = p.scope.getBinding(specifier.local.name)?.referencePaths ?? []
          if (t.isImportNamespaceSpecifier(specifier))
            for (const ref of references)
              record(p.node.source.value, this.namespaceMember(ref), [ref.parentPath ?? ref])
          else
            record(
              p.node.source.value,
              t.isImportDefaultSpecifier(specifier) ? 'default' : propertyName(specifier.imported),
              references
            )
        }
      },
    })
    if (this.counted.size % 64 === 0) reclaimMemory()
  }

  /** Returns changed source files responsible for each potentially affected consumer. */
  causes(changed: Set<string>, other: DependencyGraph): Map<string, Set<string>> {
    const reverse = new Map<string, Set<string>>()
    for (const graph of [this, other])
      for (const [file, dependencies] of graph.dependencies)
        for (const dependency of dependencies) {
          const consumers = reverse.get(dependency) ?? new Set<string>()
          consumers.add(file)
          reverse.set(dependency, consumers)
        }
    const result = new Map<string, Set<string>>()
    for (const root of changed) {
      const symbols = this.changedSymbols(root, other)
      const members = symbols ? this.changedMembers(root, other) : undefined
      const visited = new Set([root])
      const active = new Map<string, Set<string> | undefined>([[root, symbols]])
      const queue = [root]
      const a = this.watches.get(root)
      const b = other.watches.get(root)
      for (const file of new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])) {
        if (
          this.modules.has(root) &&
          other.modules.has(root) &&
          JSON.stringify([...(a?.get(file) ?? [])].sort()) ===
            JSON.stringify([...(b?.get(file) ?? [])].sort())
        )
          continue
        if (!visited.has(file)) {
          visited.add(file)
          active.set(file, undefined)
          queue.push(file)
        }
      }
      for (let index = 0; index < queue.length; index++) {
        const upstream = queue[index]
        const inputs = active.get(upstream)
        for (const file of reverse.get(upstream) ?? []) {
          const candidates = [this, other].filter((graph) => {
            if (!graph.dependencies.get(file)?.has(upstream)) return false
            const imported = graph.edgeSymbols.get(`${file}\0${upstream}`)
            return (
              !inputs ||
              !imported ||
              imported.has('*') ||
              [...inputs].some((symbol) => imported.has(symbol))
            )
          })
          if (!candidates.length) continue
          const projections = inputs
            ? candidates.map((graph) =>
                graph.propagatedSymbols(
                  file,
                  upstream,
                  inputs,
                  upstream === root ? members : undefined
                )
              )
            : [undefined]
          const next = projections.some((projection) => projection === undefined)
            ? undefined
            : new Set(projections.flatMap((projection) => [...projection!]))
          if (next?.size === 0) continue
          if (!visited.has(file)) {
            visited.add(file)
            active.set(file, next)
            queue.push(file)
          } else {
            const previous = active.get(file)
            if (previous && (!next || [...next].some((symbol) => !previous.has(symbol)))) {
              active.set(file, next ? new Set([...previous, ...next]) : undefined)
              queue.push(file)
            }
          }
        }
      }
      for (const file of visited) {
        const roots = result.get(file) ?? new Set<string>()
        roots.add(root)
        result.set(file, roots)
      }
    }
    return result
  }

  usages(file: string, symbols?: Set<string>): Usage[] {
    for (const candidate of this.modules.keys())
      if (candidate !== file && this.dependencies.get(candidate)?.has(file)) this.count(candidate)
    return [
      ...new Map(
        this.references
          .filter(
            (reference) =>
              reference.origin.file === file &&
              reference.usage.location.file !== file &&
              (!symbols || symbols.has(reference.origin.symbol))
          )
          .map(({ usage }) => [JSON.stringify(usage), usage])
      ).values(),
    ].sort(
      (a, b) =>
        a.location.file.localeCompare(b.location.file, 'en') ||
        a.location.line - b.location.line ||
        a.location.column - b.location.column ||
        a.symbol.localeCompare(b.symbol, 'en')
    )
  }

  imported(from: string, specifier: string, name: string) {
    const target = this.tree.resolve(from, specifier)
    if (!target) return undefined
    const trace = this.trace(target, name)
    return {
      routes: trace.routes,
      origins: trace.origins.map(({ file, symbol }) => ({ file, symbol })),
      uncertain: trace.uncertain,
      effects: trace.routes.flatMap((file) => {
        const effects = this.modules.get(file)?.effects
        return effects ? [{ file, fingerprint: effects }] : []
      }),
    }
  }

  private bindingFacts(file: string): BindingFacts | undefined {
    if (this.bindingSnapshots.has(file)) return this.bindingSnapshots.get(file)
    const source = this.tree.texts.get(file)
    if (!source || !this.script.test(file)) return undefined
    const values = new Map<string, string>()
    const reverse = new Map<string, Set<string>>()
    const unowned = new Set<string>()
    const members = new Map<string, { keys?: string[]; owners?: string[] }[]>()
    const resolver = new Resolver(this.tree)
    const ast = parseSyntax(source, file)
    traverse(ast, {
      Program(p) {
        const entries = Object.entries(p.scope.bindings)
        const owners = new Map<t.Node, Set<string>>()
        for (const [name, binding] of entries) {
          const names = owners.get(binding.path.node) ?? new Set<string>()
          names.add(name)
          owners.set(binding.path.node, names)
        }
        for (const [name, binding] of entries) {
          const declaration = binding.path.parentPath
          values.set(
            name,
            fingerprint([
              binding.path.node,
              binding.constantViolations.map((path) => path.node),
              declaration?.isImportDeclaration() ? declaration.node.source.value : null,
            ])
          )
          const dependents = new Set<string>()
          for (const reference of binding.referencePaths) {
            if (reference.isExportDeclaration()) continue
            if (reference.findParent((parent) => parent.isTSType() || parent.isExportSpecifier()))
              continue
            const owner = reference.findParent((parent) => owners.has(parent.node))
            if (owner) for (const name of owners.get(owner.node)!) dependents.add(name)
            else unowned.add(name)
            if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier()) {
              const member = reference.parentPath
              const keys =
                member?.isMemberExpression() && member.node.object === reference.node
                  ? member.node.computed
                    ? finiteKeys(member.get('property') as NodePath, file, resolver)?.keys?.map(
                        String
                      )
                    : [propertyName(member.node.property)]
                  : undefined
              const references = members.get(name) ?? []
              references.push({ keys, owners: owner ? [...owners.get(owner.node)!] : undefined })
              members.set(name, references)
            }
          }
          reverse.set(name, dependents)
        }
        p.stop()
      },
    })
    const effects = ast.program.body.filter(
      (node) =>
        !t.isImportDeclaration(node) &&
        !t.isExportDeclaration(node) &&
        !t.isVariableDeclaration(node) &&
        !t.isFunctionDeclaration(node) &&
        !t.isClassDeclaration(node) &&
        !t.isTSInterfaceDeclaration(node) &&
        !t.isTSTypeAliasDeclaration(node) &&
        !t.isEmptyStatement(node)
    )
    const result = {
      values,
      reverse,
      unowned,
      members,
      effects: fingerprint([ast.program.directives, effects]),
    }
    this.bindingSnapshots.set(file, result)
    if (this.bindingSnapshots.size % 64 === 0) reclaimMemory()
    return result
  }

  /** Follow an imported binding only into local values that reference it. Unknown effects remain broad. */
  private propagatedSymbols(
    file: string,
    upstream: string,
    symbols: Set<string>,
    changedMembers?: Map<string, Set<string>>
  ): Set<string> | undefined {
    try {
      const facts = this.bindingFacts(file)
      const module = this.modules.get(file)
      const edge = this.edgeSymbols.get(`${file}\0${upstream}`)
      if (!facts || !module || module.barrel || !edge || edge.has('*')) return undefined
      const seeds = new Set<string>()
      let matched = false
      for (const [local, imported] of module.imports) {
        if (!imported.source) continue
        const target = this.tree.resolve(file, imported.source)
        if (!target) continue
        const trace = this.trace(target, imported.name)
        for (const origin of trace.origins) {
          if (origin.file !== upstream || !symbols.has(origin.symbol)) continue
          matched = true
          const keys = changedMembers?.get(origin.symbol)
          if (!keys) {
            seeds.add(local)
            continue
          }
          for (const reference of facts.members.get(local) ?? []) {
            if (!reference.keys) {
              seeds.add(local)
              break
            }
            if (!reference.keys.some((key) => keys.has(key))) continue
            if (!reference.owners) return undefined
            for (const owner of reference.owners) seeds.add(owner)
          }
        }
      }
      if (!matched) return undefined
      const queue = [...seeds]
      for (let index = 0; index < queue.length; index++) {
        if (facts.unowned.has(queue[index])) return undefined
        for (const dependent of facts.reverse.get(queue[index]) ?? [])
          if (!seeds.has(dependent)) {
            seeds.add(dependent)
            queue.push(dependent)
          }
      }
      return seeds
    } catch {
      return undefined
    }
  }

  /** Project changed schema keys only when other changed local helpers cannot affect the environment. */
  private changedMembers(
    file: string,
    other: DependencyGraph
  ): Map<string, Set<string>> | undefined {
    try {
      const before = this.bindingFacts(file)
      const after = other.bindingFacts(file)
      if (!before || !after) return undefined
      const a = environmentFields(this.tree.texts.get(file)!, file)
      const b = environmentFields(other.tree.texts.get(file)!, file)
      const result = new Map<string, Set<string>>()
      for (const [name, value] of a) {
        const next = b.get(name)
        if (!next || value.options !== next.options) continue
        const related = new Set(
          [...new Set([...before.values.keys(), ...after.values.keys()])].filter(
            (key) => key !== name && before.values.get(key) !== after.values.get(key)
          )
        )
        const queue = [...related]
        for (let index = 0; index < queue.length; index++)
          for (const dependent of new Set([
            ...(before.reverse.get(queue[index]) ?? []),
            ...(after.reverse.get(queue[index]) ?? []),
          ]))
            if (!related.has(dependent)) {
              related.add(dependent)
              queue.push(dependent)
            }
        if (related.has(name)) continue
        result.set(
          name,
          new Set(
            [...new Set([...value.fields.keys(), ...next.fields.keys()])].filter(
              (key) => value.fields.get(key) !== next.fields.get(key)
            )
          )
        )
      }
      return result
    } catch {
      return undefined
    }
  }

  /** Identifies changed top-level bindings and local dependents; module effects stay conservative. */
  changedSymbols(file: string, other: DependencyGraph, otherFile = file): Set<string> | undefined {
    try {
      const a = this.bindingFacts(file)
      const b = other.bindingFacts(otherFile)
      if (!a || !b || a.effects !== b.effects) return undefined
      const changed = new Set(
        [...new Set([...a.values.keys(), ...b.values.keys()])].filter(
          (name) => a.values.get(name) !== b.values.get(name)
        )
      )
      if (!changed.size) return undefined
      const queue = [...changed]
      for (let index = 0; index < queue.length; index++)
        for (const name of new Set([
          ...(a.reverse.get(queue[index]) ?? []),
          ...(b.reverse.get(queue[index]) ?? []),
        ])) {
          if (!changed.has(name)) {
            changed.add(name)
            queue.push(name)
          }
        }
      return changed
    } catch {
      return undefined
    }
  }
}
