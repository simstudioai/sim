import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import traverse, { type Scope } from '@babel/traverse'
import * as t from '@babel/types'
import { compareStrings } from '@sim/utils/string'
import ts from '@typescript/typescript6'
import { LRUCache } from 'lru-cache'
import postcss from 'postcss'
import { centralCompiler, centralCompilerDiagnostics } from '#design-conformance/design-system'
import { canonical, category, family, hash, TOKEN_FILE } from '#design-conformance/model'
import {
  type Compiler,
  competingProperties,
  compilerIdentity,
  declarations,
  variablesIn,
} from '#design-conformance/normalize'
import type { SystemInput } from '#design-conformance/system-snapshot'

export const GENERATED_FILE = 'scripts/design-conformance/contracts.generated.json'
export interface StylingSlot {
  protected: string[]
  allowed: string[]
  recipes: string[]
  forwards: { target: string; slot: string }[]
  unchecked?: string[]
}
export interface VisualExport {
  source: { file: string; line: number; name: string }
  kind: 'component' | 'icon' | 'nonvisual'
  importSource: '@sim/emcn' | '@sim/emcn/icons'
  exportName: string
  aliasOf?: string
  variants: Record<
    string,
    { values: (string | boolean | number)[]; default?: string | boolean | number }
  >
  slots: Record<string, StylingSlot>
  relationships: string[]
}
export interface GeneratedContracts {
  version: '2.1.0'
  sourceHash: string
  exports: Record<string, VisualExport>
  recipes: Record<
    string,
    {
      classes: string[]
      variants: Record<string, string[]>
      defaults: Record<string, string | boolean | number>
    }
  >
  tokens: Record<string, { definitions: { context: string; value: string }[]; aliases: string[] }>
  diagnostics: { file: string; line: number; reason: string }[]
}
const caches = new LRUCache<string, Promise<GeneratedContracts>>({ max: 4 })
const key = (n: t.Node) =>
  t.isIdentifier(n) || t.isJSXIdentifier(n)
    ? n.name
    : t.isStringLiteral(n) || t.isNumericLiteral(n)
      ? String(n.value)
      : ''
const unwrap = (n: t.Node): t.Node =>
  t.isTSAsExpression(n) || t.isTSSatisfiesExpression(n) || t.isTSNonNullExpression(n)
    ? unwrap(n.expression)
    : n
const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compareStrings)
const mod = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, '')
interface ModuleFacts {
  ast: t.File
  bindings: Map<string, t.Node>
  functions: Map<string, t.Function>
  imports: Map<string, string>
  exports: Map<string, string>
  stars: string[]
  references: WeakMap<t.Node, { name: string; node?: t.Node; imported?: string; mutable?: boolean }>
  mutable: Set<string>
}
/** The complete source inventory is independent of consumer uses and policy registrations. */
export const metadataSource = (file: string) =>
  /^packages\/emcn\/src\/.*\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec|generated)\./.test(file)

export function infrastructureStatus(metadata: GeneratedContracts, actual?: string) {
  const expected = generatedBytes(metadata)
  return {
    fresh: actual === expected,
    expectedHash: hash(expected),
    actualHash: actual === undefined ? null : hash(actual),
    command: 'bun run design:generate',
  }
}

export function generatedBytes(result: GeneratedContracts): string {
  const objectLines = (value: Record<string, unknown>) =>
    Object.entries(value)
      .map(([name, facts]) => `    ${JSON.stringify(name)}: ${JSON.stringify(facts)}`)
      .join(',\n')
  return `{\n  "version": "${result.version}",\n  "sourceHash": "${result.sourceHash}",\n  "exports": {\n${objectLines(result.exports)}\n  },\n  "recipes": {\n${objectLines(result.recipes)}\n  },\n  "tokens": {\n${objectLines(result.tokens)}\n  },\n  "diagnostics": ${JSON.stringify(result.diagnostics)}\n}\n`
}
export async function generateContracts(
  input: SystemInput,
  compiled?: Compiler
): Promise<GeneratedContracts> {
  const sources = new Map(
    input.snapshot.entries
      .filter((e) => metadataSource(e.path) || e.path.endsWith('.css'))
      .map((e) => [e.path, input.read(e)])
  )
  const system = compiled ?? (await centralCompiler(input))
  const identity = hash(
    canonical({
      sources: [...sources].sort(([a], [b]) => compareStrings(a, b)),
      compiler: compilerIdentity(system),
    })
  )
  const cacheKey = `${identity}:${hash(readFileSync(new URL('./generated-contracts.ts', import.meta.url)))}`
  const cached = caches.get(cacheKey)
  if (cached) return cached
  const pending = generate(sources, identity, system)
  caches.set(cacheKey, pending)
  pending.catch(() => caches.delete(cacheKey))
  return pending
}

async function generate(
  sources: Map<string, string>,
  sourceHash: string,
  compiled?: Compiler
): Promise<GeneratedContracts> {
  const out: GeneratedContracts = {
    version: '2.1.0',
    sourceHash,
    exports: {},
    recipes: {},
    tokens: {},
    diagnostics: compiled ? [...centralCompilerDiagnostics(compiled)] : [],
  }
  let stylingNotes: string[] | undefined
  let deferredNotes: GeneratedContracts['diagnostics'] | undefined
  let acceptedStylingInput: ((file: string, node: t.Node) => boolean) | undefined
  const note = (file: string, line: number, reason: string) => {
    if (deferredNotes) {
      deferredNotes.push({ file, line, reason })
      return
    }
    stylingNotes?.push(reason)
    if (!out.diagnostics.some((d) => d.file === file && d.line === line && d.reason === reason))
      out.diagnostics.push({ file, line, reason })
  }
  const tokenLocations = new Map<string, { file: string; line: number }>()
  const modules = new Map<string, ModuleFacts>()
  const resolveFile = (file: string, specifier: string) => {
    const base = specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(file), specifier)
      : specifier === '@sim/emcn'
        ? 'packages/emcn/src/index'
        : specifier.startsWith('@sim/emcn/')
          ? `packages/emcn/src/${specifier.slice(10)}`
          : specifier
    const stem = base.replace(/\.[cm]?jsx?$/, '')
    return [
      base,
      ...[base, stem].flatMap((name) =>
        ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.d.mts', '.d.cts'].map(
          (extension) => `${name}${extension}`
        )
      ),
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((f) => sources.has(f))
  }
  for (const [file, source] of sources) {
    if (file.endsWith('.css')) {
      const ast = postcss.parse(source, { from: file })
      ast.walkDecls((d) => {
        if (!d.prop.startsWith('--')) return
        const contexts: string[] = []
        let p = d.parent
        while (p && p.type !== 'root') {
          contexts.unshift(
            p.type === 'rule' ? p.selector : p.type === 'atrule' ? `@${p.name} ${p.params}` : ''
          )
          p = p.parent
        }
        const token = (out.tokens[d.prop] ??= { definitions: [], aliases: [] })
        const definition = { context: contexts.join(' > '), value: d.value }
        tokenLocations.set(`${d.prop}#${canonical(definition)}`, {
          file,
          line: d.source?.start?.line ?? 1,
        })
        if (!token.definitions.some((x) => canonical(x) === canonical(definition)))
          token.definitions.push(definition)
        token.aliases = sorted([...token.aliases, ...variablesIn(d.value)])
      })
      continue
    }
    if (Buffer.byteLength(source) > 2 * 1024 * 1024)
      throw new Error(`Extraction failure: ${file}: source exceeds 2 MiB`)
    let ast: t.File
    try {
      ast = parse(source, {
        sourceType: 'module',
        plugins: [['typescript', { dts: /\.d\.[cm]?ts$/.test(file) }], 'jsx'],
      })
    } catch (error) {
      throw new Error(`Extraction failure: ${file}: ${String(error)}`)
    }
    const facts: ModuleFacts = {
      ast,
      bindings: new Map(),
      functions: new Map(),
      imports: new Map(),
      exports: new Map(),
      stars: [],
      references: new WeakMap(),
      mutable: new Set(),
    }
    for (const st of ast.program.body) {
      if (t.isImportDeclaration(st))
        for (const spec of st.specifiers)
          facts.imports.set(
            spec.local.name,
            `${resolveFile(file, st.source.value) ?? st.source.value}#${t.isImportSpecifier(spec) ? key(spec.imported) : t.isImportDefaultSpecifier(spec) ? 'default' : '*'}`
          )
      if (
        (t.isExportAllDeclaration(st) || t.isExportNamedDeclaration(st)) &&
        st.source?.value.startsWith('.') &&
        !resolveFile(file, st.source.value)
      )
        throw new Error(
          `Extraction failure: unresolved public export ${file} -> ${st.source.value}`
        )
    }
    for (const st of ast.program.body) {
      if (t.isExportAllDeclaration(st)) {
        const target = resolveFile(file, st.source.value)
        if (target) facts.stars.push(target)
      }
      if (t.isExportNamedDeclaration(st))
        for (const spec of st.specifiers) {
          const target = st.source ? (resolveFile(file, st.source.value) ?? st.source.value) : file
          facts.exports.set(
            key(spec.exported),
            `${target}#${t.isExportSpecifier(spec) ? key(spec.local) : '*'}`
          )
        }
      if (t.isExportDefaultDeclaration(st)) {
        const declaration = st.declaration
        if (
          (t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) &&
          declaration.id
        )
          facts.exports.set('default', `${file}#${declaration.id.name}`)
        else facts.bindings.set('default', declaration)
      }
    }
    const scopeIds = new WeakMap<Scope, string>()
    const scopeChildren = new WeakMap<Scope, number>()
    const scopeId = (scope: Scope): string => {
      if (t.isProgram(scope.block)) return ''
      const cached = scopeIds.get(scope)
      if (cached) return cached
      const parent = scope.parent
      const prefix = parent ? scopeId(parent) : ''
      const ordinal = parent ? (scopeChildren.get(parent) ?? 0) + 1 : 1
      if (parent) scopeChildren.set(parent, ordinal)
      const owner = scope.path.parentPath?.node
      const hint =
        t.isFunctionDeclaration(scope.block) || t.isFunctionExpression(scope.block)
          ? scope.block.id?.name
          : t.isVariableDeclarator(owner) && t.isIdentifier(owner.id)
            ? owner.id.name
            : t.isObjectMethod(scope.block) || t.isClassMethod(scope.block)
              ? key(scope.block.key)
              : undefined
      const result = `${prefix ? `${prefix}/` : ''}${hint ?? `${scope.block.type}[${ordinal}]`}`
      scopeIds.set(scope, result)
      return result
    }
    traverse(ast, {
      enter(p) {
        if (p.isScope())
          for (const binding of Object.values(p.scope.bindings)) {
            const name = t.isProgram(binding.scope.block)
              ? binding.identifier.name
              : `${binding.identifier.name}@${scopeId(binding.scope)}`
            const value = binding.path.isVariableDeclarator()
              ? binding.path.node.init
              : binding.path.isFunctionDeclaration()
                ? binding.path.node
                : undefined
            if (!binding.constant) facts.mutable.add(name)
            else if (value) facts.bindings.set(name, value)
          }
        if (!p.isIdentifier() && !p.isJSXIdentifier()) return
        const binding = p.scope.getBinding(p.node.name)
        if (!binding) return
        const name = t.isProgram(binding.scope.block)
          ? binding.identifier.name
          : `${binding.identifier.name}@${scopeId(binding.scope)}`
        const node = binding.path.isVariableDeclarator()
          ? binding.path.node.init
          : binding.path.isFunctionDeclaration()
            ? binding.path.node
            : undefined
        const imported =
          binding.path.isImportSpecifier() ||
          binding.path.isImportDefaultSpecifier() ||
          binding.path.isImportNamespaceSpecifier()
            ? facts.imports.get(binding.identifier.name)
            : undefined
        facts.references.set(p.node, {
          name,
          ...(node && binding.constant ? { node } : {}),
          ...(imported ? { imported } : {}),
          ...(!binding.constant ? { mutable: true } : {}),
        })
      },
    })
    const functionOf = (raw: t.Node, seen = new Set<string>()): t.Function | undefined => {
      const node = unwrap(raw)
      if (t.isFunction(node)) return node
      if (seen.size >= 12) return
      if (t.isIdentifier(node)) {
        const ref = facts.references.get(node)
        const value = ref ? ref.node : facts.bindings.get(node.name)
        return value && !seen.has(node.name)
          ? functionOf(value, new Set(seen).add(node.name))
          : undefined
      }
      if (t.isCallExpression(node)) {
        const name = t.isIdentifier(node.callee)
          ? node.callee.name
          : t.isMemberExpression(node.callee)
            ? key(node.callee.property)
            : ''
        if (/^(?:memo|forwardRef)$/.test(name) && t.isExpression(node.arguments[0]))
          return functionOf(node.arguments[0], seen)
      }
      return
    }
    for (const [name, node] of facts.bindings) {
      const fn = functionOf(node)
      if (fn) facts.functions.set(name, fn)
    }
    modules.set(file, facts)
  }
  const locate = (
    file: string,
    name: string,
    seen = new Set<string>(),
    reference?: t.Node
  ): { file: string; name: string; node: t.Node } | undefined => {
    const scoped = reference && modules.get(file)?.references.get(reference)
    if (scoped) name = scoped.name
    const id = `${file}#${name}`
    if (seen.has(id) || seen.size >= 12) {
      note(file, 1, `Unresolved or cyclic implementation reference: ${id}`)
      return
    }
    const facts = modules.get(file)
    if (scoped?.mutable || facts?.mutable.has(name)) {
      note(
        file,
        reference?.loc?.start.line ?? 1,
        `Unresolved mutable styling binding: ${name.split('@')[0]}`
      )
      return
    }
    const node = scoped ? scoped.node : facts?.bindings.get(name)
    if (node) {
      const value = unwrap(node)
      if (t.isIdentifier(value)) return locate(file, value.name, new Set(seen).add(id), value)
      if (
        t.isCallExpression(value) &&
        t.isMemberExpression(value.callee) &&
        t.isIdentifier(value.callee.object, { name: 'Object' }) &&
        key(value.callee.property) === 'assign' &&
        t.isIdentifier(value.arguments[0])
      )
        return locate(file, value.arguments[0].name, new Set(seen).add(id), value.arguments[0])
      return { file, name, node: value }
    }
    const ref = scoped ? scoped.imported : (facts?.imports.get(name) ?? facts?.exports.get(name))
    if (ref) {
      const [target, imported] = ref.split('#')
      return locate(target, imported, new Set(seen).add(id))
    }
    if (!scoped)
      for (const target of facts?.stars ?? []) {
        const found = locate(target, name, new Set(seen).add(id))
        if (found) return found
      }
    return
  }
  const namespaceReference = (file: string, node: t.Node): string | undefined => {
    if (!t.isIdentifier(node) && !t.isJSXIdentifier(node)) return
    const facts = modules.get(file)
    const scoped = facts?.references.get(node)
    return scoped
      ? scoped.imported
      : (facts?.imports.get(node.name) ?? facts?.exports.get(node.name))
  }
  const expressionReference = (file: string, node: t.Node) => {
    node = unwrap(node)
    if (t.isIdentifier(node)) return locate(file, node.name, new Set(), node)
    if (t.isMemberExpression(node) && (!node.computed || t.isStringLiteral(node.property))) {
      const ref = namespaceReference(file, node.object)
      if (ref?.endsWith('#*')) return locate(ref.slice(0, -2), key(node.property))
    }
    return undefined
  }
  const absentAppearance = (file: string, raw: t.Node) => {
    const node = unwrap(raw)
    return (
      t.isNullLiteral(node) ||
      (t.isIdentifier(node, { name: 'undefined' }) &&
        !modules.get(file)?.references.has(node) &&
        !modules.get(file)?.bindings.has('undefined'))
    )
  }
  const memberValues = (
    file: string,
    node: t.Node,
    seen = new Set<string>()
  ): { file: string; node: t.Node }[] => {
    node = unwrap(node)
    if (seen.size >= 12) return []
    if (t.isIdentifier(node)) {
      const ref = `${file}#${node.name}`
      const found = locate(file, node.name, new Set(), node)
      return found && !seen.has(ref)
        ? memberValues(found.file, found.node, new Set(seen).add(ref))
        : []
    }
    if (t.isConditionalExpression(node) || t.isLogicalExpression(node)) {
      const branches = t.isConditionalExpression(node)
        ? [node.consequent, node.alternate]
        : [node.left, node.right]
      return branches.flatMap((branch) => memberValues(file, branch, seen))
    }
    if (t.isMemberExpression(node)) {
      const selected =
        !node.computed || t.isStringLiteral(node.property) || t.isNumericLiteral(node.property)
          ? key(node.property)
          : undefined
      const reference = expressionReference(file, node)
      if (reference) return memberValues(reference.file, reference.node, seen)
      return memberValues(file, node.object, seen).flatMap((object) =>
        t.isObjectExpression(object.node)
          ? object.node.properties.flatMap((property) =>
              t.isObjectProperty(property) &&
              (selected === undefined || key(property.key) === selected)
                ? memberValues(object.file, property.value, seen)
                : []
            )
          : []
      )
    }
    return [{ file, node }]
  }
  const strings = (file: string, node: t.Node, seen = new Set<string>()): string[] => {
    node = unwrap(node)
    if (absentAppearance(file, node)) return []
    if (seen.size >= 12) {
      note(file, node.loc?.start.line ?? 1, 'Styling expression resolution limit')
      return []
    }
    if (t.isStringLiteral(node)) return node.value.split(/\s+/).filter(Boolean)
    if (t.isTemplateLiteral(node)) {
      const embedded = node.expressions.flatMap((expression) => {
        const values = strings(file, expression, seen)
        if (!values.length)
          note(file, node.loc?.start.line ?? 1, 'Dynamic styling template remains unchecked')
        return values
      })
      return [...node.quasis.flatMap((q) => q.value.raw.split(/\s+/).filter(Boolean)), ...embedded]
    }
    if (t.isIdentifier(node)) {
      const ref = `${file}#${node.name}`
      const found = locate(file, node.name, new Set(), node)
      if (!found && !acceptedStylingInput?.(file, node))
        note(file, node.loc?.start.line ?? 1, `Unresolved styling identifier: ${node.name}`)
      return found && !seen.has(ref) ? strings(found.file, found.node, new Set(seen).add(ref)) : []
    }
    if (t.isConditionalExpression(node))
      return [...strings(file, node.consequent, seen), ...strings(file, node.alternate, seen)]
    if (t.isLogicalExpression(node))
      return [...strings(file, node.left, seen), ...strings(file, node.right, seen)]
    if (t.isArrayExpression(node))
      return node.elements.flatMap((n) => (n ? strings(file, n, seen) : []))
    if (t.isObjectExpression(node))
      return node.properties.flatMap((p) =>
        t.isObjectProperty(p)
          ? [
              ...(!t.isBooleanLiteral(p.value, { value: false }) ? [key(p.key)] : []),
              ...(t.isStringLiteral(p.value) ||
              t.isObjectExpression(unwrap(p.value)) ||
              t.isArrayExpression(unwrap(p.value))
                ? strings(file, p.value, seen)
                : []),
            ]
          : t.isSpreadElement(p)
            ? strings(file, p.argument, seen)
            : []
      )
    if (t.isMemberExpression(node)) {
      const values = memberValues(file, node, seen)
      if (!values.length) note(file, node.loc?.start.line ?? 1, 'Unresolved styling member lookup')
      return values.flatMap((value) => strings(value.file, value.node, seen))
    }
    if (t.isFunction(node)) {
      const returns: t.Node[] = []
      if (t.isBlockStatement(node.body))
        t.traverseFast(node.body, (n) => {
          if (t.isReturnStatement(n) && n.argument) returns.push(n.argument)
        })
      else returns.push(node.body)
      return returns.flatMap((n) => strings(file, n, seen))
    }
    if (t.isCallExpression(node)) {
      const found = expressionReference(file, node.callee)
      const ref = found && `${found.file}#${found.name}`
      if (ref && out.recipes[ref]) return out.recipes[ref].classes
      const callee = t.isIdentifier(node.callee)
        ? node.callee.name
        : t.isMemberExpression(node.callee)
          ? key(node.callee.property)
          : ''
      const combining =
        /^(?:cn|clsx|classNames|twMerge)$/.test(callee) ||
        (!!found && /^(?:cn|clsx|classNames|twMerge)$/.test(found.name))
      const cva =
        namespaceReference(file, node.callee) === 'class-variance-authority#cva' ||
        (t.isMemberExpression(node.callee) &&
          namespaceReference(file, node.callee.object) === 'class-variance-authority#*' &&
          key(node.callee.property) === 'cva')
      if (!found && !combining && !cva)
        note(
          file,
          node.loc?.start.line ?? 1,
          `Unresolved styling call: ${callee || 'dynamic callee'}`
        )
      return [
        ...node.arguments.flatMap((a) => (t.isExpression(a) ? strings(file, a, seen) : [])),
        ...(found && !combining && ref && !seen.has(ref)
          ? strings(found.file, found.node, new Set(seen).add(ref))
          : []),
      ]
    }
    if (!t.isBooleanLiteral(node) && !t.isNumericLiteral(node) && !t.isNullLiteral(node))
      note(file, node.loc?.start.line ?? 1, `Unsupported styling expression: ${node.type}`)
    return []
  }
  const scalar = (
    file: string,
    raw: t.Node,
    seen = new Set<t.Node>()
  ): string | boolean | number | undefined => {
    const node = unwrap(raw)
    if (seen.has(node) || seen.size >= 12) return
    if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
      return node.value
    if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument))
      return -node.argument.value
    const found = expressionReference(file, node)
    return found ? scalar(found.file, found.node, new Set(seen).add(node)) : undefined
  }
  type Field = { file: string; name: string; value: t.Node }
  const objectFields = (
    file: string,
    raw: t.Node,
    seen = new Set<t.Node>()
  ): { fields: Field[]; unknown: { file: string; node: t.Node }[] } => {
    const node = unwrap(raw)
    if (seen.has(node) || seen.size >= 12) return { fields: [], unknown: [{ file, node }] }
    const next = new Set(seen).add(node)
    const found = expressionReference(file, node)
    if (found) return objectFields(found.file, found.node, next)
    if (!t.isObjectExpression(node)) return { fields: [], unknown: [{ file, node }] }
    const fields = new Map<string, Field>()
    const unknown: { file: string; node: t.Node }[] = []
    for (const property of node.properties) {
      if (
        t.isObjectProperty(property) &&
        (!property.computed || t.isStringLiteral(property.key) || t.isNumericLiteral(property.key))
      )
        fields.set(key(property.key), { file, name: key(property.key), value: property.value })
      else if (t.isSpreadElement(property)) {
        const spread = objectFields(file, property.argument, next)
        for (const field of spread.fields) fields.set(field.name, field)
        unknown.push(...spread.unknown)
      } else unknown.push({ file, node: property })
    }
    return { fields: [...fields.values()], unknown }
  }
  const recipeNotes = new Map<string, string[]>()
  for (const [file, facts] of modules)
    for (const [name, node] of facts.bindings) {
      const value = unwrap(node)
      if (!t.isCallExpression(value)) continue
      const imported = t.isIdentifier(value.callee)
        ? namespaceReference(file, value.callee)
        : t.isMemberExpression(value.callee) && key(value.callee.property) === 'cva'
          ? namespaceReference(file, value.callee.object)?.replace(/#\*$/, '#cva')
          : undefined
      if (imported !== 'class-variance-authority#cva') continue
      stylingNotes = []
      const recipe: GeneratedContracts['recipes'][string] = {
        classes: sorted(
          value.arguments[0] && t.isExpression(value.arguments[0])
            ? strings(file, value.arguments[0])
            : []
        ),
        variants: {},
        defaults: {},
      }
      const config = value.arguments[1]
      if (config && t.isExpression(config)) {
        const resolved = objectFields(file, config)
        for (const unknown of resolved.unknown)
          note(unknown.file, unknown.node.loc?.start.line ?? 1, 'Unresolved CVA configuration')
        for (const field of resolved.fields) {
          if (field.name === 'compoundVariants') {
            const found = expressionReference(field.file, field.value)
            const compounds = unwrap(found?.node ?? field.value)
            const compoundFile = found?.file ?? field.file
            if (t.isArrayExpression(compounds))
              for (const compound of compounds.elements) {
                if (!compound || !t.isExpression(compound)) continue
                const fields = objectFields(compoundFile, compound)
                for (const item of fields.fields)
                  if (item.name === 'class' || item.name === 'className')
                    recipe.classes.push(...strings(item.file, item.value))
                for (const unknown of fields.unknown)
                  note(
                    unknown.file,
                    unknown.node.loc?.start.line ?? 1,
                    'Unresolved CVA compound variant'
                  )
              }
            else
              note(compoundFile, compounds.loc?.start.line ?? 1, 'Unresolved CVA compound variants')
            continue
          }
          if (field.name !== 'variants' && field.name !== 'defaultVariants') continue
          const axes = objectFields(field.file, field.value)
          for (const unknown of axes.unknown)
            note(unknown.file, unknown.node.loc?.start.line ?? 1, `Unresolved CVA ${field.name}`)
          for (const axis of axes.fields)
            if (field.name === 'variants') {
              const values = objectFields(axis.file, axis.value)
              recipe.variants[axis.name] = sorted(values.fields.map((v) => v.name))
              for (const item of values.fields)
                recipe.classes.push(...strings(item.file, item.value))
              for (const unknown of values.unknown)
                note(
                  unknown.file,
                  unknown.node.loc?.start.line ?? 1,
                  `Unresolved CVA variant ${axis.name}`
                )
            } else {
              const fallback = scalar(axis.file, axis.value)
              if (fallback !== undefined) recipe.defaults[axis.name] = fallback
              else
                note(
                  axis.file,
                  axis.value.loc?.start.line ?? 1,
                  `Unresolved CVA default ${axis.name}`
                )
            }
        }
      }
      recipe.classes = sorted(recipe.classes)
      out.recipes[`${file}#${name}`] = recipe
      recipeNotes.set(`${file}#${name}`, sorted(stylingNotes))
      stylingNotes = undefined
    }
  if (!compiled) throw new Error('Extraction failure: central compiler is missing')
  const tw = compiled
  const protectedFor = (classes: string[], file: string, line: number) =>
    sorted(
      classes.flatMap((value) => {
        const ds = declarations(
          { kind: 'class', property: 'class', value, line: 1, column: 1, context: '' },
          tw,
          {},
          true
        )
        if (ds === null) {
          note(file, line, `Unresolved central styling utility: ${value}`)
          return []
        }
        return ds.flatMap((d) => {
          const p = family(d.property)
          if (
            p.startsWith('--') ||
            ['layout', 'layering', 'motion'].includes(d.category) ||
            p === 'margin' ||
            (/^(?:min|max)-(?:width|height)$/.test(p) &&
              /^(?:0|100%|auto|fit-content|inherit)$/.test(d.value)) ||
            (['width', 'height'].includes(p) && /^(?:100%|auto|fit-content|inherit)$/.test(d.value))
          )
            return []
          return [p, ...(/^min-(?:height|width)$/.test(p) ? [p.slice(4)] : [])]
        })
      })
    )
  // Snapshot-only compiler host: no workspace implementation is read through disk.
  // Third-party types and TS libraries are inputs of the pinned tool installation.
  const virtualRoot = path.resolve(import.meta.dirname, '../..', '.__design_snapshot__')
  const paths = new Map(
    [...sources]
      .filter(([f]) => /\.[cm]?[jt]sx?$/.test(f))
      .map(([f, s]) => [path.join(virtualRoot, f), s])
  )
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    baseUrl: virtualRoot,
    paths: { '@sim/emcn': ['packages/emcn/src/index.ts'], '@sim/emcn/*': ['packages/emcn/src/*'] },
  }
  const disk = ts.createCompilerHost(options)
  const allowed = (f: string) => f.includes('/node_modules/') && !f.includes('/node_modules/@sim/')
  const host: ts.CompilerHost = {
    ...disk,
    fileExists: (f) => paths.has(f) || (allowed(f) && disk.fileExists(f)),
    readFile: (f) => paths.get(f) ?? (allowed(f) ? disk.readFile(f) : undefined),
    directoryExists: (d) =>
      d.startsWith(virtualRoot) || (d.includes('/node_modules') && !!disk.directoryExists?.(d)),
    getCurrentDirectory: () => virtualRoot,
    getSourceFile(f, languageVersion) {
      const text = this.readFile(f)
      return text === undefined ? undefined : ts.createSourceFile(f, text, languageVersion, true)
    },
  }
  const program = ts.createProgram([...paths.keys()], options, host)
  const checker = program.getTypeChecker()
  const cssTypes = program
    .getSourceFiles()
    .find((f) => /\/node_modules\/csstype\/index\.d\.ts$/.test(f.fileName))
  const cssModule = cssTypes && checker.getSymbolAtLocation(cssTypes)
  const cssSymbol =
    cssModule && checker.getExportsOfModule(cssModule).find((s) => s.name === 'PropertiesHyphen')
  const cssProperties = new Set(
    cssSymbol
      ? checker
          .getDeclaredTypeOfSymbol(cssSymbol)
          .getProperties()
          .map((p) => p.name)
      : []
  )
  for (const error of program.getSyntacticDiagnostics())
    if (error.file && paths.has(error.file.fileName))
      throw new Error(
        `Extraction failure: ${path.relative(virtualRoot, error.file.fileName)}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`
      )
  const unaliased = (symbol: ts.Symbol) =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  for (const file of program.getSourceFiles()) {
    if (!paths.has(file.fileName)) continue
    const explicit = new Set<string>()
    const stars = new Map<string, ts.Symbol>()
    for (const statement of file.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      )
        for (const specifier of statement.exportClause.elements) explicit.add(specifier.name.text)
      if (
        ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations)
            if (ts.isIdentifier(declaration.name)) explicit.add(declaration.name.text)
        } else if (
          ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)
        ) {
          if (statement.name && ts.isIdentifier(statement.name)) explicit.add(statement.name.text)
        }
      }
    }
    for (const statement of file.statements) {
      if (!ts.isExportDeclaration(statement)) continue
      const target =
        statement.moduleSpecifier && checker.getSymbolAtLocation(statement.moduleSpecifier)
      if (statement.moduleSpecifier && !target)
        throw new Error(
          `Extraction failure: invalid public export ${path.relative(virtualRoot, file.fileName)}: unresolved export module`
        )
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const symbol = checker.getExportSpecifierLocalTargetSymbol(specifier)
          if (!symbol || !unaliased(symbol).declarations?.length)
            throw new Error(
              `Extraction failure: invalid public export ${path.relative(virtualRoot, file.fileName)}: missing symbol ${specifier.propertyName?.text ?? specifier.name.text}`
            )
        }
      } else if (!statement.exportClause && target)
        for (const symbol of checker.getExportsOfModule(target)) {
          if (symbol.name === 'default' || explicit.has(symbol.name)) continue
          const actual = unaliased(symbol)
          const previous = stars.get(symbol.name)
          if (previous && previous !== actual)
            throw new Error(
              `Extraction failure: ambiguous public export ${path.relative(virtualRoot, file.fileName)}: ${symbol.name}`
            )
          stars.set(symbol.name, actual)
        }
    }
  }
  if (
    [...sources.keys()].some((file) => file.startsWith('packages/emcn/src/')) &&
    !sources.has('packages/emcn/src/index.ts')
  )
    throw new Error(
      'Extraction failure: required public export barrel packages/emcn/src/index.ts is missing'
    )
  const literalValues = (type: ts.Type): (string | boolean | number)[] | undefined => {
    const types = type.isUnion() ? type.types : [type]
    const values: (string | boolean | number)[] = []
    for (const item of types) {
      if (item.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) continue
      if (item.isStringLiteral() || item.isNumberLiteral()) values.push(item.value)
      else if (item.flags & ts.TypeFlags.BooleanLiteral)
        values.push(checker.typeToString(item) === 'true')
      else return undefined
    }
    return values.length
      ? [...new Set(values)].sort((a, b) => compareStrings(String(a), String(b)))
      : undefined
  }
  // Inspect only the public parameter's declarative type closure. Unrelated imports
  // and implementation bodies are outside this boundary, and library types are pinned.
  const unresolvedProps = (props: ts.Type | undefined, parameter: ts.Symbol | undefined) => {
    const unknown = new Map<ts.Node, string>()
    const visited = new Set<ts.Node>()
    const inspectDeclaration = (declaration: ts.Declaration) => {
      if (!paths.has(declaration.getSourceFile().fileName)) return
      if (ts.isInterfaceDeclaration(declaration)) inspect(declaration)
      else if (ts.isTypeAliasDeclaration(declaration)) inspect(declaration.type)
      else if (ts.isTypeParameterDeclaration(declaration)) {
        if (declaration.constraint) inspect(declaration.constraint)
        if (declaration.default) inspect(declaration.default)
      }
    }
    const inspect = (node: ts.Node) => {
      if (visited.has(node)) return
      if (visited.size >= 512) {
        unknown.set(node, 'type resolution limit')
        return
      }
      visited.add(node)
      const reference = ts.isTypeReferenceNode(node)
        ? node.typeName
        : ts.isExpressionWithTypeArguments(node)
          ? node.expression
          : ts.isTypeQueryNode(node)
            ? node.exprName
            : undefined
      if (reference) {
        const symbol = checker.getSymbolAtLocation(reference)
        const target = symbol && unaliased(symbol)
        if (!target?.declarations?.length) unknown.set(node, reference.getText())
        else for (const declaration of target.declarations) inspectDeclaration(declaration)
      }
      if (
        ts.isImportTypeNode(node) &&
        checker.getTypeAtLocation(node).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)
      )
        unknown.set(node, node.getText())
      ts.forEachChild(node, inspect)
    }
    for (const declaration of parameter?.declarations ?? [])
      if (ts.isParameter(declaration) && declaration.type) inspect(declaration.type)
    const inspectType = (type: ts.Type) => {
      for (const declaration of (type.aliasSymbol ?? type.getSymbol())?.declarations ?? [])
        inspectDeclaration(declaration)
      if (type.isUnionOrIntersection()) for (const part of type.types) inspectType(part)
    }
    if (props) inspectType(props)
    if (
      props &&
      props.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter) &&
      !unknown.size
    ) {
      const declaration = parameter?.valueDeclaration ?? parameter?.declarations?.[0]
      if (declaration) unknown.set(declaration, checker.typeToString(props))
    }
    return [...unknown].map(([node, type]) => ({
      file: path.relative(virtualRoot, node.getSourceFile().fileName),
      line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
      type,
    }))
  }
  const defaultsUnknown = new Set<string>()
  const internalIds = new Map<string, string>()
  const metadataByExport = new Map<
    string,
    {
      file: string
      name: string
      fn?: t.Function
      docs: string
      props?: ts.Type
      defaults: Record<string, string | boolean | number>
    }
  >()
  const barrels = ['packages/emcn/src/index.ts', 'packages/emcn/src/icons/index.ts']
  const walkSymbol = (
    publicName: string,
    symbol: ts.Symbol,
    depth = 0,
    importSource: VisualExport['importSource'] = '@sim/emcn'
  ) => {
    const exportId = importSource === '@sim/emcn/icons' ? `icons:${publicName}` : publicName
    if (depth > 12) {
      note('packages/emcn/src/index.ts', 1, `Public export resolution limit: ${publicName}`)
      return
    }
    if (out.exports[exportId]) return
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration || !(symbol.flags & ts.SymbolFlags.Value)) return
    const file = path.relative(virtualRoot, declaration.getSourceFile().fileName)
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const signatures = type.getCallSignatures()
    const visualName = /^[A-Z]/.test(publicName.split('.').at(-1) ?? publicName)
    if (visualName) {
      let name = symbol.name
      const source = modules.get(file)
      if (ts.isShorthandPropertyAssignment(declaration)) {
        const valueSymbol = checker.getShorthandAssignmentValueSymbol(declaration)
        if (valueSymbol) {
          walkSymbol(publicName, valueSymbol, depth, importSource)
          return
        }
      }
      if (ts.isPropertyAssignment(declaration) && ts.isIdentifier(declaration.initializer))
        name = declaration.initializer.text
      const found = locate(file, name)
      const sourceFile = found?.file ?? file
      name = found?.name ?? name
      let fn = modules.get(sourceFile)?.functions.get(name)
      if (!fn && ts.isPropertyAssignment(declaration)) {
        t.traverseFast(modules.get(sourceFile)?.ast ?? t.file(t.program([])), (node) => {
          if (t.isFunction(node) && node.start === declaration.initializer.getStart()) fn = node
        })
      }
      const params = signatures[0]?.parameters ?? []
      const props = params[0]
        ? checker.getTypeOfSymbolAtLocation(params[0], declaration)
        : undefined
      const propsNotes = unresolvedProps(props, params[0]).map((boundary) => {
        const reason = `Public props boundary of ${publicName} is unresolved or unconstrained: ${boundary.type}; styling ownership remains unchecked`
        note(boundary.file, boundary.line, reason)
        return reason
      })
      const slots: VisualExport['slots'] = {}
      if (props)
        for (const prop of props.getProperties()) {
          const own = prop.declarations?.some((d) =>
            modules.has(path.relative(virtualRoot, d.getSourceFile().fileName))
          )
          if (
            /^(?:className|style)$/.test(prop.name) ||
            (own && /(?:ClassName|Style|[Ii]con)$/.test(prop.name))
          )
            slots[prop.name] = { protected: [], allowed: [], recipes: [], forwards: [] }
        }
      const defaults: Record<string, string | boolean | number> = {}
      const docParts = [ts.displayPartsToString(symbol.getDocumentationComment(checker))]
      for (const tag of symbol.getJsDocTags(checker))
        if (/^design(?:Allow|Protect)$/.test(tag.name))
          docParts.push(`@${tag.name} ${ts.displayPartsToString(tag.text)}`)
      if (fn) {
        const objectParams = new Set(
          fn.params.flatMap((param) =>
            t.isIdentifier(param)
              ? [modules.get(sourceFile)?.references.get(param)?.name ?? param.name]
              : []
          )
        )
        const recordDefaults = (pattern: t.ObjectPattern) => {
          for (const property of pattern.properties) {
            if (
              propsNotes.length &&
              t.isObjectProperty(property) &&
              /^(?:className|style|.*ClassName|.*Style|.*[Ii]con)$/.test(key(property.key))
            )
              slots[key(property.key)] ??= {
                protected: [],
                allowed: [],
                recipes: [],
                forwards: [],
              }
            if (t.isObjectProperty(property) && t.isAssignmentPattern(property.value)) {
              const value = scalar(sourceFile, property.value.right)
              if (value !== undefined) defaults[key(property.key)] = value
              else {
                defaultsUnknown.add(`${exportId}#${key(property.key)}`)
                note(
                  sourceFile,
                  property.loc?.start.line ?? 1,
                  `Unresolved component default: ${publicName}.${key(property.key)}`
                )
              }
            }
          }
        }
        for (const param of fn.params) if (t.isObjectPattern(param)) recordDefaults(param)
        t.traverseFast(fn.body, (node) => {
          if (
            t.isVariableDeclarator(node) &&
            t.isObjectPattern(node.id) &&
            t.isIdentifier(node.init) &&
            objectParams.has(
              modules.get(sourceFile)?.references.get(node.init)?.name ?? node.init.name
            )
          )
            recordDefaults(node.id)
          if (
            propsNotes.length &&
            t.isMemberExpression(node) &&
            t.isIdentifier(node.object) &&
            objectParams.has(
              modules.get(sourceFile)?.references.get(node.object)?.name ?? node.object.name
            ) &&
            (!node.computed || t.isStringLiteral(node.property)) &&
            /^(?:className|style|.*ClassName|.*Style|.*[Ii]con)$/.test(key(node.property))
          )
            slots[key(node.property)] ??= { protected: [], allowed: [], recipes: [], forwards: [] }
        })
      }
      for (const slot of Object.values(slots))
        if (propsNotes.length) slot.unchecked = sorted([...(slot.unchecked ?? []), ...propsNotes])
      const isIcon = sourceFile.includes('/icons/') || sourceFile.includes('/illustrations/')
      const line =
        declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1
      out.exports[exportId] = {
        importSource,
        exportName: publicName,
        source: { file: sourceFile, line, name },
        kind: isIcon
          ? 'icon'
          : signatures.length || type.getConstructSignatures().length
            ? 'component'
            : 'nonvisual',
        variants: {},
        slots,
        relationships: [],
      }
      const internal = `${sourceFile}#${name}`
      const existing = internalIds.get(internal)
      if (existing) out.exports[exportId].aliasOf = existing
      else internalIds.set(internal, exportId)
      metadataByExport.set(exportId, {
        file: sourceFile,
        name,
        fn,
        docs: docParts.join('\n'),
        props,
        defaults,
      })
      if (!fn && !isIcon && (source || signatures.length || type.getConstructSignatures().length)) {
        const reason = `Implementation of ${publicName} is delegated or unsupported; styling ownership remains unchecked`
        note(file, line, reason)
        for (const slot of Object.values(slots)) slot.unchecked = [reason]
      }
    }
    // Object.assign compound exports expose public callable properties; never inventory HTML props.
    if (visualName || symbol.flags & (ts.SymbolFlags.Namespace | ts.SymbolFlags.ValueModule))
      for (const property of type.getProperties())
        if (/^[A-Z]/.test(property.name))
          walkSymbol(`${publicName}.${property.name}`, property, depth + 1, importSource)
  }
  for (const barrel of barrels) {
    const file = program.getSourceFile(path.join(virtualRoot, barrel))
    const symbol = file && checker.getSymbolAtLocation(file)
    if (symbol)
      for (const exported of checker
        .getExportsOfModule(symbol)
        .sort((a, b) => compareStrings(a.name, b.name)))
        walkSymbol(
          exported.name,
          exported,
          0,
          barrel.includes('/icons/') ? '@sim/emcn/icons' : '@sim/emcn'
        )
  }
  // Private presentational functions supply ownership to public wrappers; they are
  // analyzed once and removed from the compact public artifact after propagation.
  const privateNames = new Set<string>()
  for (const [file, module] of modules)
    for (const [name, fn] of module.functions) {
      const id = `${file}#${name}`
      if (internalIds.has(id)) continue
      const privateName = `private:${id}`
      internalIds.set(id, privateName)
      privateNames.add(privateName)
      const slots: VisualExport['slots'] = {}
      for (const p of fn.params)
        if (t.isObjectPattern(p))
          for (const field of p.properties)
            if (
              t.isObjectProperty(field) &&
              /^(?:className|style|.*ClassName|.*Style|.*[Ii]con)$/.test(key(field.key))
            )
              slots[key(field.key)] = { protected: [], allowed: [], recipes: [], forwards: [] }
      out.exports[privateName] = {
        importSource: '@sim/emcn',
        exportName: name,
        source: { file, line: fn.loc?.start.line ?? 1, name },
        kind: 'component',
        variants: {},
        slots,
        relationships: [],
      }
      metadataByExport.set(privateName, { file, name, fn, docs: '', defaults: {} })
    }
  for (const [publicName, meta] of metadataByExport) {
    const entry = out.exports[publicName]
    const usedRecipes = new Set<string>()
    const params = new Map<string, string>()
    const objects = new Set<string>()
    const rests = new Map<string, Set<string>>()
    const bindingName = (node: t.Node) =>
      modules.get(meta.file)?.references.get(node)?.name ?? key(node)
    const patternProps = (pattern: t.ObjectPattern) => {
      const consumed = new Set(
        pattern.properties.flatMap((p) => (t.isObjectProperty(p) ? [key(p.key)] : []))
      )
      for (const field of pattern.properties) {
        if (t.isRestElement(field) && t.isIdentifier(field.argument))
          rests.set(bindingName(field.argument), consumed)
        if (t.isObjectProperty(field)) {
          const value = t.isAssignmentPattern(field.value) ? field.value.left : field.value
          if (t.isIdentifier(value)) params.set(bindingName(value), key(field.key))
        }
      }
    }
    if (meta.fn) {
      for (const p of meta.fn.params) {
        if (t.isIdentifier(p)) objects.add(bindingName(p))
        if (t.isObjectPattern(p)) patternProps(p)
      }
      t.traverseFast(meta.fn.body, (n) => {
        if (
          t.isVariableDeclarator(n) &&
          t.isObjectPattern(n.id) &&
          t.isIdentifier(n.init) &&
          objects.has(bindingName(n.init))
        )
          patternProps(n.id)
      })
      const propOf = (file: string, n: t.Node) =>
        file !== meta.file
          ? undefined
          : t.isIdentifier(n)
            ? params.get(bindingName(n))
            : t.isMemberExpression(n) &&
                t.isIdentifier(n.object) &&
                objects.has(bindingName(n.object)) &&
                (!n.computed || t.isStringLiteral(n.property))
              ? key(n.property)
              : undefined
      const visitValue = (
        file: string,
        raw: t.Node,
        visit: (file: string, node: t.Node) => void,
        seen = new Set<t.Node>()
      ) => {
        if (seen.has(raw)) return
        if (seen.size >= 256) {
          note(file, raw.loc?.start.line ?? 1, 'Styling alias resolution limit')
          return
        }
        seen.add(raw)
        t.traverseFast(raw, (node) => {
          visit(file, node)
          if (t.isIdentifier(node) || t.isMemberExpression(node)) {
            const found = expressionReference(file, node)
            if (found) visitValue(found.file, found.node, visit, seen)
          }
        })
      }
      const inputsOf = (file: string, node: t.Node) => {
        const inputs = new Set<string>()
        visitValue(file, node, (source, child) => {
          const prop = propOf(source, child)
          if (prop && entry.slots[prop]) inputs.add(prop)
        })
        return inputs
      }
      acceptedStylingInput = (file, node) => !!propOf(file, node)
      t.traverseFast(meta.fn.body, (node) => {
        let tag: string
        let root: t.Node
        type Attribute = { name: string; file: string; value: t.Node; input?: string }
        type UnknownProps = {
          file: string
          node: t.Node
          keys?: string[]
          reason?: string
          notes?: GeneratedContracts['diagnostics']
        }
        const operations: (Attribute | { unknown: UnknownProps })[] = []
        const unknownBundles: string[] = []
        const spread = (file: string, raw: t.Node, seen = new Set<t.Node>()) => {
          const value = unwrap(raw)
          if (file === meta.file && t.isIdentifier(value)) {
            const name = bindingName(value)
            if (rests.has(name) || objects.has(name)) {
              for (const input of Object.keys(entry.slots))
                if (!rests.get(name)?.has(input))
                  operations.push({ name: input, file, value, input })
              return
            }
          }
          if (seen.has(value) || seen.size >= 12) {
            operations.push({ unknown: { file, node: value } })
            return
          }
          const next = new Set(seen).add(value)
          const notes: GeneratedContracts['diagnostics'] = []
          const previous = deferredNotes
          let found: ReturnType<typeof expressionReference>
          try {
            deferredNotes = notes
            found = expressionReference(file, value)
          } finally {
            deferredNotes = previous
          }
          if (found) {
            spread(found.file, found.node, next)
            return
          }
          if (t.isObjectExpression(value)) {
            for (const property of value.properties)
              if (
                t.isObjectProperty(property) &&
                (!property.computed ||
                  t.isStringLiteral(property.key) ||
                  t.isNumericLiteral(property.key))
              )
                operations.push({ name: key(property.key), file, value: property.value })
              else if (t.isSpreadElement(property)) spread(file, property.argument, next)
              else
                operations.push({
                  unknown: {
                    file,
                    node: property,
                    ...(t.isObjectMethod(property) && !property.computed
                      ? { keys: [key(property.key)] }
                      : {}),
                  },
                })
            return
          }
          if (
            t.isNullLiteral(value) ||
            t.isBooleanLiteral(value) ||
            t.isNumericLiteral(value) ||
            t.isStringLiteral(value) ||
            t.isIdentifier(value, { name: 'undefined' })
          )
            return
          operations.push({ unknown: { file, node: value, notes } })
        }
        if (t.isJSXOpeningElement(node)) {
          tag = t.isJSXIdentifier(node.name)
            ? node.name.name
            : t.isJSXMemberExpression(node.name)
              ? `${key(node.name.object)}.${key(node.name.property)}`
              : ''
          root = t.isJSXMemberExpression(node.name) ? node.name.object : node.name
          for (const attr of node.attributes)
            if (t.isJSXSpreadAttribute(attr)) spread(meta.file, attr.argument)
            else if (t.isJSXAttribute(attr))
              operations.push({
                name: key(attr.name),
                file: meta.file,
                value: attr.value
                  ? t.isJSXExpressionContainer(attr.value)
                    ? attr.value.expression
                    : attr.value
                  : t.booleanLiteral(true),
              })
        } else if (
          t.isCallExpression(node) &&
          (t.isIdentifier(node.callee, { name: 'createElement' }) ||
            (t.isMemberExpression(node.callee) && key(node.callee.property) === 'createElement'))
        ) {
          const target = node.arguments[0]
          if (!target || !t.isExpression(target)) return
          tag = t.isStringLiteral(target)
            ? target.value
            : t.isIdentifier(target)
              ? target.name
              : t.isMemberExpression(target)
                ? `${key(target.object)}.${key(target.property)}`
                : ''
          root = t.isMemberExpression(target) ? target.object : target
          const props = node.arguments[1]
          if (props && t.isExpression(props) && !t.isNullLiteral(props)) spread(meta.file, props)
        } else return
        if (!tag) {
          const reason = 'Unresolved rendered element target'
          note(meta.file, node.loc?.start.line ?? 1, reason)
          unknownBundles.push(reason)
        }
        const [base, ...member] = tag.split('.')
        const ref =
          namespaceReference(meta.file, root) ?? `${meta.file}#${bindingName(root) || base}`
        const [targetFile, targetName] = ref.split('#')
        const target = `${targetFile}#${member.length ? `${targetName === '*' ? '' : `${targetName}.`}${member.join('.')}` : targetName}`
        const native = /^[a-z]/.test(tag)
        // JSX and object spreads assign from left to right. Resolve this ordering
        // before tracing ownership, so overwritten values cannot supply chrome.
        const effective = new Map<string, Attribute>()
        const pending: { unknown: UnknownProps; overwritten: Set<string> }[] = []
        for (const operation of operations) {
          if ('unknown' in operation) {
            if (operation.unknown.keys)
              for (const name of operation.unknown.keys) effective.delete(name)
            else effective.clear()
            pending.push({ unknown: operation.unknown, overwritten: new Set() })
            continue
          }
          const previous = effective.get(operation.name)
          if (
            operation.input &&
            previous &&
            !previous.input &&
            propOf(previous.file, previous.value) !== operation.input
          ) {
            pending.push({
              unknown: {
                file: operation.file,
                node: operation.value,
                keys: [operation.name],
                reason: `Rendered public props may override authored ${operation.name}; default ownership remains unchecked`,
              },
              overwritten: new Set(),
            })
          }
          if (!operation.input)
            for (const boundary of pending) boundary.overwritten.add(operation.name)
          effective.set(operation.name, operation)
        }
        for (const { unknown, overwritten } of pending) {
          const keys = unknown.keys ?? (native ? ['className', 'style'] : undefined)
          const affected = native
            ? keys?.filter((name) => /^(?:className|style|.*ClassName|.*Style)$/.test(name))
            : keys
          if (affected?.every((name) => overwritten.has(name))) continue
          const reason = unknown.reason ?? 'Unresolved rendered props bundle'
          note(unknown.file, unknown.node.loc?.start.line ?? 1, reason)
          unknownBundles.push(reason)
          for (const diagnostic of unknown.notes ?? []) {
            note(diagnostic.file, diagnostic.line, diagnostic.reason)
            unknownBundles.push(diagnostic.reason)
          }
        }
        const attributes = [...effective.values()]
        const spreadInputs = new Set(attributes.flatMap((attr) => (attr.input ? [attr.input] : [])))
        if (!native) entry.relationships.push(target)
        const iconProp = propOf(meta.file, root)
        if (iconProp && /icon/i.test(iconProp) && attributes.some((a) => a.name === 'className')) {
          const classes = attributes
            .filter((a) => a.name === 'className' && !a.input)
            .flatMap((a) => strings(a.file, a.value))
          stylingNotes = []
          const protectedProperties = protectedFor(classes, meta.file, node.loc?.start.line ?? 1)
          entry.slots[iconProp] = {
            protected: protectedProperties,
            allowed: [],
            recipes: [],
            forwards: [],
            ...(stylingNotes.length ? { unchecked: sorted(stylingNotes) } : {}),
          }
          stylingNotes = undefined
        }
        if (!native)
          for (const input of spreadInputs)
            entry.slots[input].forwards.push({ target, slot: input })
        const nodeInputs = new Set<string>(native ? spreadInputs : [])
        const nodeOwned: string[] = []
        const nodeNotes: string[] = [...unknownBundles]
        for (const attr of attributes) {
          const slotName = attr.name
          if (!/^(?:className|style|.*ClassName|.*Style)$/.test(slotName)) {
            const forwarded = attr.input ?? propOf(attr.file, attr.value)
            if (!native && forwarded && entry.slots[forwarded])
              entry.slots[forwarded].forwards.push({ target, slot: slotName })
            continue
          }
          const inputs = attr.input ? new Set([attr.input]) : inputsOf(attr.file, attr.value)
          const recipes = new Set<string>()
          if (!attr.input)
            visitValue(attr.file, attr.value, (file, child) => {
              if (!t.isCallExpression(child)) return
              const found = expressionReference(file, child.callee)
              const id = found && `${found.file}#${found.name}`
              if (id && out.recipes[id]) {
                recipes.add(id)
                usedRecipes.add(id)
              }
            })
          stylingNotes = []
          const classChannel = /(?:^className$|ClassName$)/.test(slotName)
          const owned = protectedFor(
            classChannel && !attr.input
              ? [
                  ...strings(attr.file, attr.value),
                  ...[...recipes].flatMap((r) => out.recipes[r].classes),
                ]
              : [],
            attr.file,
            attr.value.loc?.start.line ?? 1
          )
          for (const recipe of recipes) stylingNotes.push(...(recipeNotes.get(recipe) ?? []))
          if (/(?:^style$|Style$)/.test(slotName) && !attr.input) {
            const resolved = objectFields(attr.file, attr.value)
            for (const field of resolved.fields) {
              const property = field.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
              if (category(property)) owned.push(family(property))
            }
            for (const unknown of resolved.unknown)
              if (
                !inputsOf(unknown.file, unknown.node).size &&
                !absentAppearance(unknown.file, unknown.node)
              )
                note(unknown.file, unknown.node.loc?.start.line ?? 1, 'Unresolved styling object')
          }
          nodeOwned.push(...owned)
          nodeNotes.push(...stylingNotes)
          for (const input of inputs) {
            nodeInputs.add(input)
            const slot = entry.slots[input]
            slot.protected.push(...owned)
            slot.recipes.push(...recipes)
            if (stylingNotes.length)
              slot.unchecked = sorted([...(slot.unchecked ?? []), ...stylingNotes])
            if (!native) slot.forwards.push({ target, slot: slotName })
          }
          stylingNotes = undefined
        }
        if (native)
          for (const input of nodeInputs) {
            const slot = entry.slots[input]
            slot.protected.push(...nodeOwned)
            if (nodeNotes.length) slot.unchecked = sorted([...(slot.unchecked ?? []), ...nodeNotes])
          }
        if (unknownBundles.length)
          for (const slot of Object.values(entry.slots))
            slot.unchecked = sorted([...(slot.unchecked ?? []), ...unknownBundles])
      })
      acceptedStylingInput = undefined
    }
    if (meta.props)
      for (const prop of meta.props.getProperties()) {
        if (/^(?:on[A-Z]|aria-|data-)/.test(prop.name) || entry.slots[prop.name]) continue
        const declaration = prop.valueDeclaration ?? prop.declarations?.[0]
        if (!declaration) continue
        // Only component-authored design inputs, not inherited native HTML inventories.
        const file = path.relative(virtualRoot, declaration.getSourceFile().fileName)
        if (!modules.has(file)) continue
        const values = literalValues(checker.getTypeOfSymbolAtLocation(prop, declaration))
        if (!values) continue
        const recipes = [...usedRecipes].filter((r) => out.recipes[r].variants[prop.name])
        const supported = values
        if (!supported.length) continue
        const fallback = defaultsUnknown.has(`${publicName}#${prop.name}`)
          ? undefined
          : (meta.defaults[prop.name] ??
            recipes.map((r) => out.recipes[r].defaults[prop.name]).find((v) => v !== undefined))
        entry.variants[prop.name] = {
          values: supported,
          ...(fallback !== undefined && supported.includes(fallback) ? { default: fallback } : {}),
        }
      }
    const declarationsBySlot = new Map<string, { allow: Set<string>; protect: Set<string> }>()
    const metadataLines = meta.docs
      .split('\n')
      .filter((line) => /@design(?:Allow|Protect)/.test(line))
    if (metadataLines.some((line) => !/@design(?:Allow|Protect)\s+[^\s]+\s+[^\s]+/.test(line)))
      throw new Error(`Malformed design ownership metadata on ${publicName}`)
    for (const match of meta.docs.matchAll(/@design(Allow|Protect)\s+([^\s]+)\s+([^\n@]+)/g)) {
      const [, mode, name, properties] = match
      if (!entry.slots[name])
        throw new Error(`Invalid @design${mode} on ${publicName}: nonexistent styling slot ${name}`)
      const decision = declarationsBySlot.get(name) ?? {
        allow: new Set<string>(),
        protect: new Set<string>(),
      }
      for (const property of properties.trim().split(/[\s,]+/)) {
        if (
          ![
            '*',
            'colours',
            'borders',
            'typography',
            'dimensions',
            'effects',
            'spacing',
            'radii',
            'visibility',
            'layout',
          ].includes(property) &&
          !cssProperties.has(property) &&
          !(category(property.replace(/^-(?:webkit|moz|ms)-/, '')) && !cssProperties.size)
        )
          throw new Error(`Invalid @design${mode} property ${property} on ${publicName}`)
        decision[mode === 'Allow' ? 'allow' : 'protect'].add(property)
      }
      declarationsBySlot.set(name, decision)
    }
    for (const [name, decision] of declarationsBySlot) {
      const overlap = [...decision.allow].some((a) =>
        [...decision.protect].some(
          (p) =>
            a === p ||
            a === '*' ||
            p === '*' ||
            competingProperties(a, p) ||
            category(a) === p ||
            category(p) === a
        )
      )
      if (overlap)
        throw new Error(`Contradictory design ownership metadata on ${publicName}.${name}`)
      entry.slots[name].allowed.push(...decision.allow)
      entry.slots[name].protected.push(...decision.protect)
    }
    entry.relationships = sorted(entry.relationships)
    for (const slot of Object.values(entry.slots)) {
      slot.protected = sorted(slot.protected)
      slot.allowed = sorted(slot.allowed)
      slot.recipes = sorted(slot.recipes)
      slot.forwards = [...new Map(slot.forwards.map((r) => [canonical(r), r])).values()].sort(
        (a, b) => compareStrings(canonical(a), canonical(b))
      )
    }
  }
  // Resolve slot forwarding to a fixed point. Unknown routes stay diagnostics, never permission.
  const targetCache = new Map<string, string | undefined>()
  const publicTarget = (target: string): string | undefined => {
    if (target.startsWith('@sim/emcn#')) return target.slice(10)
    if (internalIds.has(target)) return internalIds.get(target)
    if (targetCache.has(target)) return targetCache.get(target)
    const [file, name] = target.split('#')
    const module = program.getSourceFile(path.join(virtualRoot, file))
    const moduleSymbol = module && checker.getSymbolAtLocation(module)
    const [root, ...members] = (name ?? '').split('.')
    let symbol =
      moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((s) => s.name === root)
    for (const member of members) {
      if (!symbol) break
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
      symbol = declaration
        ? checker.getTypeOfSymbolAtLocation(symbol, declaration).getProperty(member)
        : undefined
    }
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol)
    let declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
      symbol = checker.getShorthandAssignmentValueSymbol(declaration)
      declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    }
    const sourceName =
      declaration &&
      ts.isPropertyAssignment(declaration) &&
      ts.isIdentifier(declaration.initializer)
        ? declaration.initializer.text
        : symbol?.name
    const result =
      declaration && sourceName
        ? internalIds.get(
            `${path.relative(virtualRoot, declaration.getSourceFile().fileName)}#${sourceName}`
          )
        : undefined
    targetCache.set(target, result)
    return result
  }
  for (const entry of Object.values(out.exports)) {
    for (const [slotName, slot] of Object.entries(entry.slots))
      for (const forward of slot.forwards) {
        const target = publicTarget(forward.target)
        if (!target || !out.exports[target]?.slots[forward.slot]) {
          const reason = `Unresolved styling forwarding: ${entry.exportName}.${slotName} -> ${forward.target}.${forward.slot}`
          note(entry.source.file, entry.source.line, reason)
          slot.unchecked = sorted([...(slot.unchecked ?? []), reason])
        }
      }
  }
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    for (const entry of Object.values(out.exports))
      for (const slot of Object.values(entry.slots))
        for (const forward of slot.forwards) {
          const name = publicTarget(forward.target)
          const next = name && out.exports[name]?.slots[forward.slot]
          if (!next) continue
          const properties = next.protected.filter(
            (p) => !next.allowed.some((a) => a === '*' || a === p || a === category(p))
          )
          const previousNotes = canonical(slot.unchecked ?? [])
          const nextNotes = sorted([...(slot.unchecked ?? []), ...(next.unchecked ?? [])])
          if (nextNotes.length) slot.unchecked = nextNotes
          if (previousNotes !== canonical(nextNotes)) changed = true
          const result = sorted([...slot.protected, ...properties])
          if (canonical(result) !== canonical(slot.protected)) {
            slot.protected = result
            changed = true
          }
        }
    if (!changed) break
    if (pass === 11) {
      const reason = 'Styling-slot forwarding resolution limit'
      note('packages/emcn/src/index.ts', 1, reason)
      for (const item of Object.values(out.exports))
        for (const slot of Object.values(item.slots))
          slot.unchecked = sorted([...(slot.unchecked ?? []), reason])
    }
  }
  for (const name of privateNames) delete out.exports[name]
  const contexts = new Map<
    string,
    Map<string, { aliases: string[]; literal: boolean; file: string; line: number }>
  >()
  for (const [name, token] of Object.entries(out.tokens))
    for (const definition of token.definitions) {
      const graph = contexts.get(definition.context) ?? new Map()
      const previous = graph.get(name)
      const aliases = variablesIn(definition.value)
      const location = tokenLocations.get(`${name}#${canonical(definition)}`) ?? {
        file: TOKEN_FILE,
        line: 1,
      }
      graph.set(name, {
        aliases: sorted([...(previous?.aliases ?? []), ...aliases]),
        literal: previous?.literal || !aliases.length,
        ...location,
      })
      contexts.set(definition.context, graph)
    }
  for (const [context, graph] of contexts)
    for (const [name, token] of graph) {
      const visit = (current: string, seen: Set<string>) => {
        if (seen.has(current)) {
          note(
            token.file,
            token.line,
            `Global token alias cycle in CSS definition context ${context || '<root>'}: ${sorted(seen).join(' -> ')}`
          )
          return
        }
        if (seen.size >= 12) {
          note(
            token.file,
            token.line,
            `Global token resolution limit in CSS definition context ${context || '<root>'}: ${name}`
          )
          return
        }
        const value = graph.get(current)
        if (!value) {
          if (!out.tokens[current])
            note(token.file, token.line, `Unresolved global token reference: ${name} -> ${current}`)
          else {
            const owner = [...seen].at(-1) ?? name
            const source = graph.get(owner) ?? token
            note(
              source.file,
              source.line,
              `Global token reference crosses CSS definition contexts; availability remains unchecked: ${owner} -> ${current} (${context || '<root>'})`
            )
          }
          return
        }
        for (const alias of value.aliases) {
          if (alias === current && value.literal) continue
          visit(alias, new Set(seen).add(current))
        }
      }
      for (const alias of token.aliases) {
        if (alias === name && token.literal) continue
        visit(alias, new Set([name]))
      }
    }
  out.exports = Object.fromEntries(
    Object.entries(out.exports).sort(([a], [b]) => compareStrings(a, b))
  )
  out.recipes = Object.fromEntries(
    Object.entries(out.recipes).sort(([a], [b]) => compareStrings(a, b))
  )
  out.tokens = Object.fromEntries(
    Object.entries(out.tokens).sort(([a], [b]) => compareStrings(a, b))
  )
  out.diagnostics.sort((a, b) => compareStrings(canonical(a), canonical(b)))
  return out
}
