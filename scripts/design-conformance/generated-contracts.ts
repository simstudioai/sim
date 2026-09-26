import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { compareStrings } from '@sim/utils/string'
import ts from '@typescript/typescript6'
import { LRUCache } from 'lru-cache'
import postcss from 'postcss'
import { canonical, category, family, hash, TOKEN_FILE } from '#design-conformance/model'
import {
  type Compiler,
  compiler,
  declarations,
  defaultTheme,
  variablesIn,
} from '#design-conformance/normalize'
import type { SystemInput } from '#design-conformance/system-snapshot'

export const GENERATED_FILE = 'scripts/design-conformance/contracts.generated.json'
export interface StylingSlot {
  protected: string[]
  allowed: string[]
  recipes: string[]
  forwards: { target: string; slot: string }[]
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
  version: '2.0.0'
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
}
/** The complete source inventory is independent of consumer uses and policy registrations. */
export const metadataSource = (file: string) =>
  /^packages\/emcn\/src\/.*\.[cm]?[jt]sx?$/.test(file) &&
  !/\.(?:test|spec|generated|d)\./.test(file)

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
export function generateContracts(
  input: SystemInput,
  compiled?: Compiler
): Promise<GeneratedContracts> {
  const sources = new Map(
    input.snapshot.entries
      .filter((e) => metadataSource(e.path) || e.path.endsWith('.css'))
      .map((e) => [e.path, input.read(e)])
  )
  const identity = hash(canonical([...sources].sort(([a], [b]) => compareStrings(a, b))))
  const cacheKey = `${identity}:${hash(readFileSync(new URL('./generated-contracts.ts', import.meta.url)))}`
  const cached = caches.get(cacheKey)
  if (cached) return cached
  const pending = generate(sources, identity, compiled)
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
    version: '2.0.0',
    sourceHash,
    exports: {},
    recipes: {},
    tokens: {},
    diagnostics: [],
  }
  const note = (file: string, line: number, reason: string) => {
    if (!out.diagnostics.some((d) => d.file === file && d.line === line && d.reason === reason))
      out.diagnostics.push({ file, line, reason })
  }
  const modules = new Map<string, ModuleFacts>()
  const resolveFile = (file: string, specifier: string) => {
    const base = specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(file), specifier)
      : specifier === '@sim/emcn'
        ? 'packages/emcn/src/index'
        : specifier.startsWith('@sim/emcn/')
          ? `packages/emcn/src/${specifier.slice(10)}`
          : specifier
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((f) =>
      sources.has(f)
    )
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
      ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    } catch (error) {
      throw new Error(`Extraction failure: ${file}: ${String(error)}`)
    }
    const facts: ModuleFacts = {
      ast,
      bindings: new Map(),
      functions: new Map(),
      imports: new Map(),
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
    t.traverseFast(ast, (n) => {
      if (t.isFunctionDeclaration(n) && n.id) {
        facts.functions.set(n.id.name, n)
        facts.bindings.set(n.id.name, n)
      }
      if (!t.isVariableDeclarator(n) || !t.isIdentifier(n.id) || !n.init) return
      facts.bindings.set(n.id.name, n.init)
      const value = unwrap(n.init)
      if (t.isFunctionExpression(value) || t.isArrowFunctionExpression(value))
        facts.functions.set(n.id.name, value)
      if (
        t.isCallExpression(value) &&
        (t.isIdentifier(value.callee)
          ? /^(?:memo|forwardRef)$/.test(value.callee.name)
          : t.isMemberExpression(value.callee) &&
            /^(?:memo|forwardRef)$/.test(key(value.callee.property)))
      ) {
        const fn = value.arguments[0]
        if (t.isFunctionExpression(fn) || t.isArrowFunctionExpression(fn))
          facts.functions.set(n.id.name, fn)
      }
    })
    const functionOf = (raw: t.Node, seen = new Set<string>()): t.Function | undefined => {
      const node = unwrap(raw)
      if (t.isFunction(node)) return node
      if (seen.size >= 12) return
      if (t.isIdentifier(node)) {
        const value = facts.bindings.get(node.name)
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
    seen = new Set<string>()
  ): { file: string; name: string; node: t.Node } | undefined => {
    const id = `${file}#${name}`
    if (seen.has(id) || seen.size >= 12) {
      note(file, 1, `Unresolved or cyclic implementation reference: ${id}`)
      return
    }
    const facts = modules.get(file)
    const node = facts?.bindings.get(name)
    if (node) {
      const value = unwrap(node)
      if (t.isIdentifier(value)) return locate(file, value.name, new Set(seen).add(id))
      if (
        t.isCallExpression(value) &&
        t.isMemberExpression(value.callee) &&
        t.isIdentifier(value.callee.object, { name: 'Object' }) &&
        key(value.callee.property) === 'assign' &&
        t.isIdentifier(value.arguments[0])
      )
        return locate(file, value.arguments[0].name, new Set(seen).add(id))
      return { file, name, node: value }
    }
    const ref = facts?.imports.get(name)
    if (ref) {
      const [target, imported] = ref.split('#')
      return locate(target, imported, new Set(seen).add(id))
    }
    return
  }
  const strings = (file: string, node: t.Node, seen = new Set<string>()): string[] => {
    node = unwrap(node)
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
      const found = locate(file, node.name)
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
        t.isObjectProperty(p) ? strings(file, p.value, seen) : []
      )
    if (t.isMemberExpression(node) && t.isIdentifier(node.object)) {
      const found = locate(file, node.object.name)
      if (found)
        return strings(found.file, found.node, new Set(seen).add(`${file}#${node.object.name}`))
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
      const found = t.isIdentifier(node.callee) ? locate(file, node.callee.name) : undefined
      const ref = found && `${found.file}#${found.name}`
      return [
        ...node.arguments.flatMap((a) => (t.isExpression(a) ? strings(file, a, seen) : [])),
        ...(found && ref && !seen.has(ref)
          ? strings(found.file, found.node, new Set(seen).add(ref))
          : []),
      ]
    }
    return []
  }
  for (const [file, facts] of modules)
    for (const [name, node] of facts.bindings) {
      const value = unwrap(node)
      if (
        !t.isCallExpression(value) ||
        !t.isIdentifier(value.callee) ||
        facts.imports.get(value.callee.name) !== 'class-variance-authority#cva'
      )
        continue
      const config = value.arguments[1]
      const recipe: GeneratedContracts['recipes'][string] = {
        classes: sorted(
          value.arguments.flatMap((a) => (t.isExpression(a) ? strings(file, a) : []))
        ),
        variants: {},
        defaults: {},
      }
      if (t.isObjectExpression(config))
        for (const prop of config.properties) {
          if (!t.isObjectProperty(prop) || !t.isObjectExpression(prop.value)) continue
          if (key(prop.key) === 'variants')
            for (const axis of prop.value.properties)
              if (t.isObjectProperty(axis) && t.isObjectExpression(axis.value))
                recipe.variants[key(axis.key)] = sorted(
                  axis.value.properties.flatMap((v) => (t.isObjectProperty(v) ? [key(v.key)] : []))
                )
          if (key(prop.key) === 'defaultVariants')
            for (const axis of prop.value.properties)
              if (
                t.isObjectProperty(axis) &&
                (t.isStringLiteral(axis.value) ||
                  t.isNumericLiteral(axis.value) ||
                  t.isBooleanLiteral(axis.value))
              )
                recipe.defaults[key(axis.key)] = axis.value.value
        }
      out.recipes[`${file}#${name}`] = recipe
    }
  const css = sources.get(TOKEN_FILE) ?? ''
  const declarativeCss = postcss.parse(css)
  declarativeCss.walkAtRules((r) => {
    if (['import', 'plugin', 'source'].includes(r.name)) r.remove()
  })
  const tw = compiled ?? (await compiler(`${defaultTheme}\n${declarativeCss.toString()}`))
  const protectedFor = (classes: string[]) =>
    sorted(
      classes.flatMap((value) => {
        const ds = declarations(
          { kind: 'class', property: 'class', value, line: 1, column: 1, context: '' },
          tw,
          {},
          true
        )
        if (ds === null) return []
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
    if (depth > 3 || out.exports[exportId]) return
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration || !(symbol.flags & ts.SymbolFlags.Value)) return
    const file = path.relative(virtualRoot, declaration.getSourceFile().fileName)
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const signatures = type.getCallSignatures()
    if (/^[A-Z]/.test(publicName)) {
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
        for (const param of fn.params)
          if (t.isObjectPattern(param))
            for (const p of param.properties)
              if (
                t.isObjectProperty(p) &&
                t.isAssignmentPattern(p.value) &&
                (t.isStringLiteral(p.value.right) ||
                  t.isNumericLiteral(p.value.right) ||
                  t.isBooleanLiteral(p.value.right))
              )
                defaults[key(p.key)] = p.value.right.value
      }
      const isIcon = sourceFile.includes('/icons/') || sourceFile.includes('/illustrations/')
      const line =
        declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1
      out.exports[exportId] = {
        importSource,
        exportName: publicName,
        source: { file: sourceFile, line, name },
        kind: isIcon ? 'icon' : fn ? 'component' : 'nonvisual',
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
      if (!fn && !isIcon && source)
        note(
          file,
          line,
          `Implementation of ${publicName} is delegated or unsupported; styling ownership remains unchecked`
        )
    }
    // Object.assign compound exports expose public callable properties; never inventory HTML props.
    if (/^[A-Z]/.test(publicName))
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
    const rests = new Set<string>()
    if (meta.fn) {
      for (const p of meta.fn.params) {
        if (t.isIdentifier(p)) objects.add(p.name)
        if (t.isObjectPattern(p))
          for (const field of p.properties) {
            if (t.isRestElement(field) && t.isIdentifier(field.argument))
              rests.add(field.argument.name)
            if (t.isObjectProperty(field)) {
              const value = t.isAssignmentPattern(field.value) ? field.value.left : field.value
              if (t.isIdentifier(value)) params.set(value.name, key(field.key))
            }
          }
      }
      t.traverseFast(meta.fn.body, (n) => {
        if (
          t.isVariableDeclarator(n) &&
          t.isObjectPattern(n.id) &&
          t.isIdentifier(n.init) &&
          objects.has(n.init.name)
        )
          for (const field of n.id.properties) {
            if (t.isRestElement(field) && t.isIdentifier(field.argument))
              rests.add(field.argument.name)
            if (t.isObjectProperty(field)) {
              const value = t.isAssignmentPattern(field.value) ? field.value.left : field.value
              if (t.isIdentifier(value)) params.set(value.name, key(field.key))
            }
          }
      })
      const propOf = (n: t.Node) =>
        t.isIdentifier(n)
          ? params.get(n.name)
          : t.isMemberExpression(n) && t.isIdentifier(n.object) && objects.has(n.object.name)
            ? key(n.property)
            : undefined
      const bundles = new Map<string, Map<string, string>>()
      t.traverseFast(meta.fn.body, (n) => {
        if (t.isVariableDeclarator(n) && t.isIdentifier(n.id) && t.isObjectExpression(n.init)) {
          const fields = new Map<string, string>()
          for (const field of n.init.properties)
            if (t.isObjectProperty(field)) {
              const input = propOf(field.value)
              if (input && entry.slots[input]) fields.set(key(field.key), input)
            }
          if (fields.size) bundles.set(n.id.name, fields)
        }
      })
      t.traverseFast(meta.fn.body, (n) => {
        if (!t.isJSXOpeningElement(n)) return
        const tag = t.isJSXIdentifier(n.name)
          ? n.name.name
          : t.isJSXMemberExpression(n.name)
            ? `${key(n.name.object)}.${key(n.name.property)}`
            : ''
        const [base, ...member] = tag.split('.')
        const ref = modules.get(meta.file)?.imports.get(base) ?? `${meta.file}#${base}`
        const [targetFile, targetName] = ref.split('#')
        const target = `${targetFile}#${member.length ? `${targetName === '*' ? '' : `${targetName}.`}${member.join('.')}` : targetName}`
        const native = /^[a-z]/.test(tag)
        if (!native) entry.relationships.push(target)
        const iconProp = params.get(base)
        if (
          iconProp &&
          /icon/i.test(iconProp) &&
          n.attributes.some((a) => t.isJSXAttribute(a) && key(a.name) === 'className')
        ) {
          const classes = n.attributes.flatMap((a) =>
            t.isJSXAttribute(a) && key(a.name) === 'className' && a.value
              ? strings(
                  meta.file,
                  t.isJSXExpressionContainer(a.value) ? a.value.expression : a.value
                )
              : []
          )
          entry.slots[iconProp] = {
            protected: protectedFor(classes),
            allowed: [],
            recipes: [],
            forwards: [],
          }
        }
        const spread = n.attributes.some(
          (a) =>
            t.isJSXSpreadAttribute(a) &&
            t.isIdentifier(a.argument) &&
            (rests.has(a.argument.name) || objects.has(a.argument.name))
        )
        for (const attribute of n.attributes)
          if (t.isJSXSpreadAttribute(attribute) && t.isIdentifier(attribute.argument)) {
            const bundle = bundles.get(attribute.argument.name)
            if (bundle && !native)
              for (const [forwarded, input] of bundle)
                entry.slots[input]?.forwards.push({ target, slot: forwarded })
          }
        if (spread && !native)
          for (const [name, slot] of Object.entries(entry.slots))
            slot.forwards.push({ target, slot: name })
        for (const attr of n.attributes) {
          if (!t.isJSXAttribute(attr) || !attr.value) continue
          const slotName = key(attr.name)
          if (!/^(?:className|style|.*ClassName|.*Style)$/.test(slotName)) {
            const forwardedInput = t.isJSXExpressionContainer(attr.value)
              ? propOf(attr.value.expression)
              : undefined
            if (!native && forwardedInput && entry.slots[forwardedInput])
              entry.slots[forwardedInput].forwards.push({ target, slot: slotName })
            continue
          }
          const value = t.isJSXExpressionContainer(attr.value) ? attr.value.expression : attr.value
          const inputs = new Set<string>()
          const recipes = new Set<string>()
          t.traverseFast(value, (child) => {
            const p = propOf(child)
            if (p && entry.slots[p]) inputs.add(p)
            if (t.isCallExpression(child) && t.isIdentifier(child.callee)) {
              const found = locate(meta.file, child.callee.name)
              const id = found && `${found.file}#${found.name}`
              if (id && out.recipes[id]) {
                recipes.add(id)
                usedRecipes.add(id)
              }
            }
          })
          if (spread && entry.slots[slotName]) inputs.add(slotName)
          const owned = protectedFor([
            ...strings(meta.file, value),
            ...[...recipes].flatMap((r) => out.recipes[r].classes),
          ])
          if (slotName === 'style')
            t.traverseFast(value, (child) => {
              if (t.isObjectProperty(child)) {
                const property = key(child.key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
                if (category(property)) owned.push(family(property))
              }
            })
          if (slotName === 'className' && inputs.has('className') && entry.slots.style)
            inputs.add('style')
          for (const input of inputs) {
            const slot = entry.slots[input]
            slot.protected.push(...owned)
            slot.recipes.push(...recipes)
            if (!native) slot.forwards.push({ target, slot: slotName })
          }
        }
      })
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
        const fallback =
          meta.defaults[prop.name] ??
          recipes.map((r) => out.recipes[r].defaults[prop.name]).find((v) => v !== undefined)
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
          (p) => a === p || a === '*' || p === '*' || category(a) === p || category(p) === a
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
  const publicTarget = (target: string) =>
    target.startsWith('@sim/emcn#') ? target.slice(10) : internalIds.get(target)
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
          const result = sorted([...slot.protected, ...properties])
          if (canonical(result) !== canonical(slot.protected)) {
            slot.protected = result
            changed = true
          }
        }
    if (!changed) break
    if (pass === 11)
      note('packages/emcn/src/index.ts', 1, 'Styling-slot forwarding resolution limit')
  }
  for (const [name, entry] of Object.entries(out.exports)) {
    if (privateNames.has(name)) continue
    for (const [slotName, slot] of Object.entries(entry.slots))
      for (const forward of slot.forwards) {
        const target = publicTarget(forward.target)
        if (!target || !out.exports[target]?.slots[forward.slot])
          note(
            entry.source.file,
            entry.source.line,
            `Unresolved styling forwarding: ${entry.exportName}.${slotName} -> ${forward.target}.${forward.slot}`
          )
      }
  }
  for (const name of privateNames) delete out.exports[name]
  for (const [name, token] of Object.entries(out.tokens)) {
    const visit = (current: string, seen: Set<string>) => {
      if (seen.has(current)) {
        note(TOKEN_FILE, 1, `Global token alias cycle: ${sorted(seen).join(' -> ')}`)
        return
      }
      if (seen.size >= 12) {
        note(TOKEN_FILE, 1, `Global token resolution limit: ${name}`)
        return
      }
      const value = out.tokens[current]
      if (!value) {
        note(TOKEN_FILE, 1, `Unresolved global token reference: ${name} -> ${current}`)
        return
      }
      for (const alias of value.aliases) {
        if (
          alias === current &&
          value.definitions.some((d) => !variablesIn(d.value).includes(current))
        )
          continue
        visit(alias, new Set(seen).add(current))
      }
    }
    for (const alias of token.aliases) {
      if (alias === name && token.definitions.some((d) => !variablesIn(d.value).includes(name)))
        continue
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
