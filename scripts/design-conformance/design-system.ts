import { posix } from 'node:path'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { compareStrings } from '@sim/utils/string'
import postcss from 'postcss'
import { extractCentralRecipes } from '#design-conformance/central-recipes'
import { centralFile, contractsHash, registry } from '#design-conformance/contracts'
import { extract } from '#design-conformance/extract'
import { type GeneratedContracts, generateContracts } from '#design-conformance/generated-contracts'
import {
  type Atom,
  type Catalogue,
  canonical,
  type Entry,
  family,
  hash,
  TOKEN_FILE,
} from '#design-conformance/model'
import {
  type Compiler,
  compiler,
  declarations,
  defaultTheme,
  rawColours,
  utility,
  variablesIn,
} from '#design-conformance/normalize'
import { type SourceSummary, summarize } from '#design-conformance/source-summary'
import type { SystemInput } from '#design-conformance/system-snapshot'

export interface Reference {
  value?: string
  recipe?: boolean
  source: string
}
type Piece = string | { ref: string }
interface Module {
  recipes?: ReturnType<typeof extractCentralRecipes>
  summary?: SourceSummary
  definitions: Atom[]
  classes: { value: string; line: number }[]
  values: Record<string, Piece[] | 'recipe'>
  exports: Record<string, string>
  stars: string[]
  theme: string
  unchecked: string[]
}
export interface DesignSystem {
  metadata: GeneratedContracts
  recipes: Record<string, ReturnType<typeof extractCentralRecipes>>
  summaries: { file: string; summary: SourceSummary }[]
  resolutionHash: string
  definitions: Record<string, Atom[]>
  hash: string
  entries: Entry[]
  catalogue: Catalogue
  compiler: Compiler
  variableFamilies: Map<string, Set<string>>
  adopted: Map<string, Set<string>>
  resolve: (ref: string) => Reference | undefined
  unchecked: { file: string; reason: string }[]
}
const modules = new Map<string, Module>()
const compilers = new Map<string, Compiler>()
const keyName = (n: t.Node) =>
  t.isIdentifier(n) ? n.name : t.isStringLiteral(n) || t.isNumericLiteral(n) ? String(n.value) : ''
const moduleName = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, '')
const resolvePath = (file: string, input: string) =>
  input.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(moduleName(file)), input))
    : input
/** Read literal central declarations and export syntax. Never invoke source functions. */
function moduleInfo(source: string, file: string): Module {
  const identity = hash(`${contractsHash}\0${file}\0${source}`)
  const hit = modules.get(identity)
  if (hit) return hit
  const out: Module = {
    values: {},
    exports: {},
    stars: [],
    theme: '',
    unchecked: [],
    classes: [],
    definitions: [],
  }
  if (!/\.[cm]?[jt]sx?$/.test(file)) return out
  if (Buffer.byteLength(source) > registry.limits.sourceBytes)
    throw new Error(`Central source exceeds parser limit: ${file}`)
  if (registry.centralRecipes?.[file]) {
    const recipes = extractCentralRecipes(file, source)
    out.recipes = recipes
    out.definitions = recipes.definitions
    out.unchecked = recipes.unchecked
    // Numeric/property-specific exports are not general className recipes.
    // Their authoring contract does not approve arbitrary consumer channels.
    if (modules.size >= 4096) modules.delete(modules.keys().next().value as string)
    modules.set(identity, out)
    return out
  }
  try {
    const ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] })
    out.summary = summarize(ast, file)
    const bindings = new Map<string, t.Node>()
    const imports = new Map<string, string>()
    const exported = new Map<string, string>()
    const declarations = (statement: t.Node) => {
      if (t.isVariableDeclaration(statement))
        for (const d of statement.declarations)
          if (t.isIdentifier(d.id) && d.init) bindings.set(d.id.name, d.init)
    }
    for (const st of ast.program.body) {
      if (t.isImportDeclaration(st))
        for (const s of st.specifiers)
          imports.set(
            s.local.name,
            `${resolvePath(file, st.source.value)}#${t.isImportSpecifier(s) ? keyName(s.imported) : t.isImportDefaultSpecifier(s) ? 'default' : '*'}`
          )
      if (t.isExportAllDeclaration(st)) out.stars.push(resolvePath(file, st.source.value))
      if (t.isExportNamedDeclaration(st)) {
        if (st.declaration) {
          declarations(st.declaration)
          if (t.isVariableDeclaration(st.declaration))
            for (const d of st.declaration.declarations)
              if (t.isIdentifier(d.id)) exported.set(d.id.name, d.id.name)
          if (t.isFunctionDeclaration(st.declaration) && st.declaration.id)
            exported.set(st.declaration.id.name, st.declaration.id.name)
        }
        for (const s of st.specifiers)
          if (t.isExportSpecifier(s)) {
            const name = keyName(s.exported)
            const local = keyName(s.local)
            if (st.source) out.exports[name] = `${resolvePath(file, st.source.value)}#${local}`
            else exported.set(name, local)
          }
      } else declarations(st)
    }
    const unwrap = (node: t.Node): t.Node =>
      t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node)
        ? unwrap(node.expression)
        : node
    const pieces = (
      node: t.Node,
      seen = new Set<string>(),
      depth = 0
    ): Piece[] | 'recipe' | undefined => {
      if (depth > 12) return undefined
      node = unwrap(node)
      if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return [String(node.value)]
      if (t.isIdentifier(node)) {
        if (imports.has(node.name)) return [{ ref: imports.get(node.name) as string }]
        const b = bindings.get(node.name)
        if (!b || seen.has(node.name)) return undefined
        return pieces(b, new Set(seen).add(node.name), depth + 1)
      }
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const target = imports.get(node.callee.name)
        if (target === 'class-variance-authority#cva') return 'recipe'
      }
      if (t.isTemplateLiteral(node)) {
        const result: Piece[] = []
        for (let i = 0; i < node.quasis.length; i++) {
          result.push(node.quasis[i].value.cooked ?? node.quasis[i].value.raw)
          if (i < node.expressions.length) {
            const p = pieces(node.expressions[i], seen, depth + 1)
            if (!p || p === 'recipe') return undefined
            result.push(...p)
          }
        }
        return result
      }
      if (t.isBinaryExpression(node, { operator: '+' })) {
        const a = pieces(node.left, seen, depth + 1)
        const b = pieces(node.right, seen, depth + 1)
        if (a && b && a !== 'recipe' && b !== 'recipe') return [...a, ...b]
      }
      return undefined
    }
    for (const [name, local] of exported) {
      const value = bindings.get(local)
      if (value) {
        const p = pieces(value)
        if (p) out.values[name] = p
      } else if (imports.has(local)) out.exports[name] = imports.get(local) as string
    }
    // Historical Tailwind theme/extend object literals, including local constant aliases.
    if (/tailwind\.config\./.test(file)) {
      const object = (
        n: t.Node | undefined,
        seen = new Set<string>()
      ): t.ObjectExpression | undefined => {
        if (!n) return undefined
        n = unwrap(n)
        if (t.isObjectExpression(n)) return n
        if (t.isIdentifier(n) && !seen.has(n.name))
          return object(bindings.get(n.name), new Set(seen).add(n.name))
        return undefined
      }
      const property = (n: t.ObjectExpression | undefined, k: string) =>
        n?.properties.find((p) => t.isObjectProperty(p) && !p.computed && keyName(p.key) === k)
      const value = (n: t.ObjectExpression | undefined, k: string) => {
        const p = property(n, k)
        return p && t.isObjectProperty(p) ? p.value : undefined
      }
      const d = ast.program.body.find((s) => t.isExportDefaultDeclaration(s))
      const config = d && t.isExportDefaultDeclaration(d) ? object(d.declaration) : undefined
      const theme = object(value(config, 'theme'))
      const vars: string[] = []
      const locations: Record<string, number> = {}
      for (const container of [theme, object(value(theme, 'extend'))])
        for (const [field, prefix] of Object.entries({
          colors: 'color',
          fontFamily: 'font',
          fontSize: 'text',
          borderRadius: 'radius',
          boxShadow: 'shadow',
        })) {
          const walk = (n: t.Node | undefined, keys: string[]) => {
            if (!n) return
            const o = object(n)
            if (o) {
              for (const p of o.properties)
                if (t.isObjectProperty(p) && !p.computed) walk(p.value, [...keys, keyName(p.key)])
              return
            }
            locations[`--${prefix}-${keys.filter((k) => k !== 'DEFAULT').join('-')}`] =
              n.loc?.start.line ?? 1
            const p = pieces(n)
            if (p && p !== 'recipe' && p.every((x) => typeof x === 'string'))
              vars.push(
                `--${prefix}-${keys.filter((k) => k !== 'DEFAULT').join('-')}:${p.join('')};`
              )
            else if (t.isArrayExpression(n) && n.elements[0]) {
              const first = pieces(n.elements[0])
              if (first && first !== 'recipe' && first.every((x) => typeof x === 'string')) {
                const items =
                  field === 'fontFamily'
                    ? n.elements.map((x) => (x ? pieces(x) : undefined))
                    : [first]
                if (
                  items.every((x) => x && x !== 'recipe' && x.every((y) => typeof y === 'string'))
                )
                  vars.push(
                    `--${prefix}-${keys.join('-')}:${items.map((x) => (x as string[]).join('')).join(',')};`
                  )
              }
            } else out.unchecked.push(`Unresolved central theme entry ${field}.${keys.join('.')}`)
          }
          const o = object(value(container, field))
          if (o)
            for (const p of o.properties)
              if (t.isObjectProperty(p) && !p.computed) walk(p.value, [keyName(p.key)])
        }
      out.theme = vars.length ? `@theme {${vars.join('')}}` : ''
      if (out.theme)
        postcss.parse(out.theme).walkDecls((d) => {
          out.definitions.push({
            kind: 'token',
            property: d.prop,
            value: d.value,
            line: locations[d.prop] ?? 1,
            column: 1,
            context: '@theme',
          })
        })
    }
    if (/(?:tailwind|postcss)\.config\./.test(file)) {
      const materialize = (node: t.Node, seen = new Set<string>(), depth = 0): unknown => {
        if (depth > 12) return '<resolution-limit>'
        node = unwrap(node)
        if (t.isIdentifier(node) && bindings.has(node.name) && !seen.has(node.name))
          return materialize(
            bindings.get(node.name) as t.Node,
            new Set(seen).add(node.name),
            depth + 1
          )
        if (t.isObjectExpression(node))
          return Object.fromEntries(
            node.properties
              .map((p) =>
                t.isObjectProperty(p) && !p.computed
                  ? [keyName(p.key), materialize(p.value, seen, depth + 1)]
                  : ['<unresolved>', p.type]
              )
              .sort(([a], [b]) => compareStrings(String(a), String(b)))
          )
        if (t.isArrayExpression(node))
          return node.elements.map((n) => (n ? materialize(n, seen, depth + 1) : null))
        if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
          return node.value
        return JSON.parse(
          JSON.stringify(node, (key, value) =>
            [
              'start',
              'end',
              'loc',
              'extra',
              'leadingComments',
              'trailingComments',
              'innerComments',
              'comments',
            ].includes(key)
              ? undefined
              : value
          )
        )
      }
      const declaration = ast.program.body.find((s) => t.isExportDefaultDeclaration(s))
      const semantic = JSON.stringify(
        declaration && t.isExportDefaultDeclaration(declaration)
          ? materialize(declaration.declaration)
          : []
      )

      out.definitions.push({
        kind: 'style',
        property: '@configuration',
        value: semantic,
        line: 1,
        column: 1,
        context: 'declarative-config',
      })
    }
  } catch {
    throw new Error(`Central source parser failure: ${file}`)
  }
  out.classes = extract(source, file)
    .atoms.filter((a) => a.kind === 'class')
    .map((a) => ({ value: a.value, line: a.line }))
  if (modules.size >= 4096) modules.delete(modules.keys().next().value as string)
  modules.set(identity, out)
  return out
}
export async function designSystem(input: SystemInput): Promise<DesignSystem> {
  const recipes: DesignSystem['recipes'] = {}
  const variables: Record<string, string[]> = {}
  const origins: Record<string, string[]> = {}
  const blocks: string[] = []
  const definitions: Record<string, Atom[]> = {}
  const info = new Map<string, Module>()
  const unchecked: DesignSystem['unchecked'] = (input.unchecked ?? []).map((reason) => ({
    file: '<central snapshot>',
    reason,
  }))
  for (const entry of input.snapshot.entries) {
    if (!centralFile(entry.path)) continue
    if (!/^100(?:644|755)$/.test(entry.mode))
      throw new Error(`Central source is not a regular file: ${entry.path}`)
    const source = input.read(entry)
    if (Buffer.byteLength(source) > registry.limits.sourceBytes)
      throw new Error(`Central source exceeds parser limit: ${entry.path}`)
    if (/\.css$/.test(entry.path) && entry.path.startsWith('apps/sim/app/_styles/')) {
      const css = postcss.parse(source)
      css.walkDecls((d) => {
        if (d.prop.startsWith('--')) {
          variables[d.prop] = [...new Set([...(variables[d.prop] ?? []), d.value])].sort()
          origins[d.prop] = [...new Set([...(origins[d.prop] ?? []), entry.path])].sort()
        }
      })
      css.each((n) => {
        if (n.type === 'atrule' && ['theme', 'custom-variant', 'utility'].includes(n.name))
          blocks.push(n.toString() + (n.nodes ? '' : ';'))
      })
    }
    if (/\.[cm]?[jt]sx?$/.test(entry.path)) {
      const m = moduleInfo(source, entry.path)
      if (m.recipes) recipes[entry.path] = m.recipes
      info.set(moduleName(entry.path), m)
      definitions[entry.path] = m.definitions
      for (const reason of m.unchecked) unchecked.push({ file: entry.path, reason })
      if (m.theme) {
        blocks.push(m.theme)
        postcss.parse(m.theme).walkDecls((d) => {
          variables[d.prop] = [d.value]
          origins[d.prop] = [entry.path]
        })
      }
    }
  }
  if (!input.snapshot.entries.some((e) => e.path === TOKEN_FILE))
    throw new Error('Required central globals.css is missing')
  const variableFamilies = new Map<string, Set<string>>()
  const adopted = new Map<string, Set<string>>()
  const mark = (name: string, family: string, seen = new Set<string>()) => {
    if (seen.has(name) || seen.size > 12) return
    variableFamilies.set(name, new Set([...(variableFamilies.get(name) ?? []), family]))
    for (const v of variables[name] ?? [])
      for (const ref of variablesIn(v)) mark(ref, family, new Set(seen).add(name))
  }
  for (const [name, values] of Object.entries(variables)) {
    const family = name.startsWith('--color-')
      ? 'colours'
      : name.startsWith('--font-') && !name.startsWith('--font-weight-')
        ? 'font-family'
        : name.startsWith('--radius')
          ? 'border-radius'
          : name.startsWith('--shadow')
            ? 'box-shadow'
            : name.startsWith('--text-') &&
                !name.includes('--line-height') &&
                values.every((v) => /^\d+(?:\.\d+)?(?:px|rem)$/.test(v))
              ? 'font-size'
              : values.some((v) => rawColours(v) && !/shadow/.test(name))
                ? 'colours'
                : undefined
    if (family) mark(name, family)
  }
  // Alias declarations inherit the type of their central target, including legacy border aliases.
  for (let pass = 0; pass < 12; pass++)
    for (const [name, values] of Object.entries(variables)) {
      if (values.every((v) => /^var\(\s*--[\w-]+\s*\)$/.test(v))) {
        const families = values.map((v) => variableFamilies.get(variablesIn(v)[0]))
        if (families.every(Boolean))
          for (const f of families[0] as Set<string>)
            if (families.every((fs) => fs?.has(f))) mark(name, f)
      }
    }
  for (const [family, names] of Object.entries(registry.builtins))
    adopted.set(family, new Set(names))
  for (const [prefix, family] of Object.entries({
    '--color-': 'colours',
    '--font-': 'font-family',
    '--text-': 'font-size',
    '--radius-': 'border-radius',
    '--shadow-': 'box-shadow',
  }))
    for (const name of Object.keys(variables))
      if (name.startsWith(prefix) && variableFamilies.get(name)?.has(family))
        adopted.get(family)?.add(name.slice(prefix.length))
  const theme = [defaultTheme, ...blocks].join('\n')
  const themeHash = hash(theme)
  let system = compilers.get(themeHash)
  if (!system) {
    system = await compiler(theme)
    if (compilers.size >= 8) compilers.delete(compilers.keys().next().value as string)
    compilers.set(themeHash, system)
  }
  // Literal named utilities in central styling definitions are explicit adoptions of
  // existing Tailwind tokens. Arbitrary literals and consumer occurrences add no permissions.
  for (const [file, module] of info)
    for (const atom of module.classes) {
      const base = utility(atom.value).base
      if (/[[(]/.test(base)) continue
      for (const d of declarations(
        {
          kind: 'class',
          property: 'class',
          value: atom.value,
          line: atom.line,
          column: 1,
          context: '',
        },
        system,
        variables,
        true
      ) ?? []) {
        const f = d.category === 'colours' ? 'colours' : family(d.property)
        if (f === 'font-weight') continue // Written finite weight rule overrides historical authoring debt.
        const prefix: Record<string, RegExp> = {
          colours:
            /^(?:text|bg|border(?:-[trblxyse])?|outline|ring(?:-offset)?|fill|stroke|decoration|from|via|to|accent|caret)-(.+?)(?:\/[\d.]+)?$/,
          'font-size': /^text-(.+)$/,
          'font-family': /^font-(.+)$/,
          'border-radius': /^rounded(?:-[trblse]{1,2})?-(.+)$/,
          'box-shadow': /^shadow-(.+)$/,
        }
        const name = base.match(prefix[f] ?? /$a/)?.[1]
        if (name && adopted.has(f)) {
          adopted.get(f)?.add(name)
          const key = `utility:${base}`
          origins[key] = [...new Set([...(origins[key] ?? []), `${file}:${atom.line}`])].sort()
        }
      }
    }
  const resolve = (ref: string, active = new Set<string>(), depth = 0): Reference | undefined => {
    if (depth > 12 || active.has(ref)) return undefined
    const [raw, name] = ref.split('#')
    const module = raw === '@sim/emcn' ? 'packages/emcn/src/index' : raw
    const m = info.get(module) ?? info.get(`${module}/index`)
    if (!m) return undefined
    const next = new Set(active).add(ref)
    const value = m.values[name]
    if (value === 'recipe') return { recipe: true, source: `${module}#${name}` }
    if (value) {
      let text = ''
      for (const p of value)
        if (typeof p === 'string') text += p
        else {
          const r = resolve(p.ref, next, depth + 1)
          if (r?.value === undefined) return undefined
          text += r.value
        }
      return { value: text, source: `${module}#${name}` }
    }
    if (m.exports[name]) return resolve(m.exports[name], next, depth + 1)
    for (const star of m.stars) {
      const r = resolve(`${star}#${name}`, next, depth + 1)
      if (r) return r
    }
    return undefined
  }
  const metadata = await generateContracts(input, system)
  unchecked.push(...metadata.diagnostics.map((d) => ({ file: d.file, reason: d.reason })))
  return {
    metadata,
    recipes,
    summaries: input.snapshot.entries.flatMap((e) => {
      const summary = info.get(moduleName(e.path))?.summary
      return summary ? [{ file: e.path, summary }] : []
    }),
    resolutionHash: hash(
      canonical([
        metadata.sourceHash,
        [...info].map(([file, m]) => [file, m.values, m.exports, m.stars]),
      ])
    ),
    definitions,
    hash: input.snapshot.hash,
    entries: input.snapshot.entries,
    catalogue: {
      version: '1.0.0',
      sourceCommit: input.snapshot.commit,
      provisional: true,
      sources: input.snapshot.entries.map((e) => ({ file: e.path, blob: e.blob })),
      theme,
      variables,
      colourTokens: [...variableFamilies]
        .filter(([, v]) => v.has('colours'))
        .map(([k]) => k)
        .sort(),
      allowed: {},
      provenance: origins,
      notes: [
        'Conformance authority is explicit central definitions, not observed consumer values.',
      ],
    },
    compiler: system,
    variableFamilies,
    adopted,
    resolve,
    unchecked,
  }
}
