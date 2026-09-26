import { posix } from 'node:path'
import { parse } from '@babel/parser'
import traverseModule, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5'
import { associateFindings } from '#control-analysis/associations'
import { inspectImperative } from '#control-analysis/imperative'
import type { Diagnostic, InventoryFinding } from '#control-analysis/model'
import { type ControlHooks, type ControlSource, compare, regular } from '#control-analysis/model'
import { nonUiScript } from '#control-analysis/non-ui'
import { productScope } from '#control-analysis/scope'
import {
  type Expr,
  expression,
  functionResult,
  immutable,
  StaticInputs,
  unknown,
} from '#control-analysis/static-inputs'
import { centralInventory, registry } from '#design-conformance/contracts'
import { canonical, hash } from '#design-conformance/model'
import { htmlSink } from '#design-conformance/rendered-html'
import type { SourceIndex } from '#design-conformance/source-summary'

const traverse =
  typeof traverseModule === 'function'
    ? traverseModule
    : (traverseModule as unknown as { default: typeof traverseModule }).default
const roles = new Set([
  'button',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'link',
  'treeitem',
])
const attributes = new Set([
  'className',
  'class',
  'style',
  'variant',
  'size',
  'shape',
  'fullWidth',
  'active',
  'disabled',
  'loading',
  'type',
  'role',
  'href',
  'asChild',
  'aria-label',
  'tabIndex',
  'aria-pressed',
  'aria-checked',
  'aria-expanded',
])
const key = (node: t.Node) =>
  t.isIdentifier(node) || t.isJSXIdentifier(node)
    ? node.name
    : t.isStringLiteral(node)
      ? node.value
      : ''
const clean = (node: t.Node): t.Node =>
  t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node)
    ? clean(node.expression)
    : node
const jsxName = (node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string =>
  t.isJSXIdentifier(node)
    ? node.name
    : t.isJSXMemberExpression(node)
      ? `${jsxName(node.object)}.${node.property.name}`
      : `${node.namespace.name}:${node.name.name}`
export interface ControlInput {
  expression: string
  values?: (string | number | boolean | null)[]
  unresolved: boolean
  mayBeUndefined?: boolean
  omitted?: boolean
  sources?: string[]
  effectiveValues?: (string | number | boolean | null)[]
  defaultSource?: string
  properties?: Record<string, ControlInput>
  composition?: 'class-inputs-before-merge'
}
interface SymbolInfo {
  kind: 'alias' | 'renderer' | 'other' | 'unknown'
  targets: string[]
  file: string
  name: string
  polymorphic?: {
    prop: string
    fallback: Expr
    yes: string
    no: string
    styled: boolean
    handlers: string[]
  }
}
interface ModuleInfo {
  exports: Map<string, string>
  stars: string[]
}
export interface RawUse {
  id: string
  file: string
  line: number
  column: number
  endLine: number
  endColumn?: number
  slots?: { name: string; line: number; column: number; endLine: number; endColumn: number }[]
  owner: string
  target: string
  tag: string
  syntax: 'jsx' | 'create-element' | 'html' | 'imperative'
  inputs: Record<string, ControlInput>
  spread: boolean
  handlers: string[]
  repeated: boolean
  recipes: string[]
  hidden: boolean
  constructionEvidence?: string[]
  inheritedHandlers?: string[]
}
export interface ControlRecord extends RawUse {
  origin:
    | 'emcn-component'
    | 'mixed-origin'
    | 'local-control'
    | 'interaction-candidate'
    | 'external-control'
    | 'unresolved'
    | 'central-implementation'
    | 'nonvisual'
  evidence: string[]
  terminals: string[]
  authoredAt: string[]
  multiplicity: 'repeated-source' | 'single-source'
  findingIds: string[]
  potentialFindingIds: string[]
  review: string
  area: string
  projection: boolean
  relationship: string[]
  stylingOwners: string[]
  appearance: { status: 'resolved' | 'unresolved'; centralRecipes: string[]; localInputs: boolean }
}
export interface ControlInventory {
  version: string
  records: ControlRecord[]
  unchecked: Diagnostic[]
  nonUi: Diagnostic[]
  coverage: {
    parsedModules: number
    excludedFiles: string[]
    skippedNonCode: number
    parseFailures: number
    sourceLimits: number
    unknownComponentUses: number
  }
  counts: Record<string, number>
  byArea: Record<string, Record<string, number>>
  limitations: string[]
}
interface Proof {
  controls: Set<string>
  unknown: Set<string>
  central: Set<string>
  implementations: Set<string>
  relationships: Set<string>
  stylingOwners: Set<string>
  handlers: Set<string>
}
const emptyProof = (): Proof => ({
  controls: new Set(),
  unknown: new Set(),
  central: new Set(),
  implementations: new Set(),
  relationships: new Set(),
  stylingOwners: new Set(),
  handlers: new Set(),
})
const merge = (into: Proof, from: Proof) => {
  for (const k of [
    'controls',
    'unknown',
    'central',
    'implementations',
    'relationships',
    'stylingOwners',
    'handlers',
  ] as const)
    for (const v of from[k]) into[k].add(v)
}
const nativeRole = (tag: string, values: Record<string, ControlInput>) => {
  const role = values.role?.values?.filter((v) => typeof v === 'string' && roles.has(v)).join('|')
  if (role) return role
  if (tag === 'button' || tag === 'select' || tag === 'summary' || tag === 'textarea') return tag
  if (tag === 'a') return 'navigation-link'
  if (
    tag === 'input' &&
    values.type?.values?.some((v) =>
      ['button', 'submit', 'reset', 'checkbox', 'radio', 'image'].includes(String(v))
    )
  )
    return 'input-control'
  return undefined
}
const areaOf = (file: string) =>
  file.startsWith('packages/')
    ? file.split('/').slice(0, 2).join('/')
    : file.startsWith('apps/sim/components/')
      ? 'Shared components'
      : file.includes('/(auth)/')
        ? 'Authentication'
        : file.includes('/(interfaces)/') || /\/app\/(?:f|invite|join|resume)\//.test(file)
          ? 'Public interfaces'
          : file.includes('/ee/')
            ? 'Enterprise'
            : file.includes('/app/o/')
              ? 'Organization'
              : /\/workspace\/\[workspaceId\]\//.test(file)
                ? file.split('/workspace/[workspaceId]/')[1].split('/')[0]
                : 'Other product'

/** Source-backed control discovery and root-renderer tracing; origin is not design approval. */
export function inspectControls(
  source: ControlSource,
  findings: InventoryFinding[],
  order: 'forward' | 'reverse' = 'forward',
  sourceIndex?: SourceIndex,
  centralReference?: (
    ref: string
  ) => { recipe?: boolean; value?: string; source: string } | undefined,
  hooks?: ControlHooks
): ControlInventory {
  const symbols = new Map<string, SymbolInfo>()
  const modules = new Map<string, ModuleInfo>()
  const mutatedImports = new Set<string>()
  const raw: RawUse[] = []
  const staticInputs = new StaticInputs((r) => resolveExport(r))
  const inputExpressions = new Map<string, Expr>()
  const renderUses = new Map<string, { target: string; props: Expr; children: string[] }>()
  const defaults = new Map<string, Expr>()
  const recipeBases = new Set<string>()
  const nonUi: Diagnostic[] = []
  const notes = new Map<string, Diagnostic>()
  const note = (file: string, line: number, context: string, reason: string) => {
    const n = { file, line, context, reason }
    notes.set(canonical(n), n)
  }
  const coverage = {
    parsedModules: 0,
    excludedFiles: [] as string[],
    skippedNonCode: 0,
    parseFailures: 0,
    sourceLimits: 0,
    unknownComponentUses: 0,
  }
  const entries = order === 'reverse' ? [...source.entries].reverse() : source.entries
  const files = new Set(source.entries.map((e) => e.path))
  const moduleRef = (file: string, spec: string) => {
    let base = spec.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(file), spec))
      : spec.startsWith('@/') && file.startsWith('apps/sim/')
        ? `apps/sim/${spec.slice(2)}`
        : spec === '@sim/emcn'
          ? 'packages/emcn/src/index'
          : spec === '@sim/emcn/icons'
            ? 'packages/emcn/src/icons/index'
            : spec === '@sim/workflow-renderer'
              ? 'packages/workflow-renderer/src/index'
              : undefined
    if (!base) return `!${spec}`
    if (/\.[cm]?js$/.test(base)) base = base.replace(/\.[cm]?js$/, '')
    const matches = [
      base,
      ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(
        (ext) => `${base}${ext}`
      ),
    ].filter((p) => files.has(p))
    return matches.length === 1
      ? matches[0]
      : `?${base}:${matches.length ? 'ambiguous' : 'missing'}`
  }
  for (const entry of entries) {
    const file = entry.path
    if (productScope(file) === 'exclude' && !centralInventory(file)) {
      coverage.excludedFiles.push(file)
      continue
    }
    if (!/\.[cm]?[jt]sx?$|\.html?$/.test(file)) {
      coverage.skippedNonCode++
      continue
    }
    if (!regular(entry) || entry.bytes > registry.limits.sourceBytes) {
      coverage.sourceLimits++
      note(
        file,
        1,
        'control-discovery',
        !regular(entry)
          ? 'Non-regular source is not followed'
          : 'Source exceeds 2 MiB; control discovery unavailable'
      )
      continue
    }
    const code = source.read(entry)
    const addHtml = (html: string, line: number, owner: string) => {
      const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
      const walk = (n: DefaultTreeAdapterMap['node']) => {
        if ('tagName' in n) {
          const inputs: Record<string, ControlInput> = {}
          for (const a of n.attrs)
            inputs[a.name === 'tabindex' ? 'tabIndex' : a.name] = {
              expression: a.value,
              values: [a.value],
              unresolved: false,
            }
          const handlers = n.attrs
            .filter((a) => /^on(?:click|pointer|mouse|key)/.test(a.name))
            .map((a) => a.name)
          if (
            nativeRole(n.tagName, inputs) ||
            handlers.length ||
            inputs.tabIndex?.values?.some((value) => Number(value) >= 0)
          ) {
            const at = line + (n.sourceCodeLocation?.startLine ?? 1) - 1
            raw.push({
              id: hash(
                canonical([file, owner, line, n.sourceCodeLocation?.startOffset, n.tagName])
              ),
              file,
              line: at,
              column: n.sourceCodeLocation?.startCol ?? 1,
              endLine: line + (n.sourceCodeLocation?.endLine ?? 1) - 1,
              owner,
              target: `native:${n.tagName}`,
              tag: n.tagName,
              syntax: 'html',
              inputs,
              spread: false,
              handlers,
              repeated: false,
              recipes: [],
              hidden: n.attrs.some((a) => a.name === 'hidden'),
            })
          }
        }
        if ('childNodes' in n) for (const c of n.childNodes) walk(c)
      }
      walk(fragment)
    }
    if (/\.html?$/.test(file)) {
      addHtml(code, 1, 'HTML document')
      continue
    }
    let ast: t.File
    try {
      ast = parse(code, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
        errorRecovery: false,
      })
    } catch (error) {
      coverage.parseFailures++
      note(file, 1, 'control-discovery', `Parser failure: ${String(error)}`)
      continue
    }
    coverage.parsedModules++
    const mod: ModuleInfo = { exports: new Map(), stars: [] }
    modules.set(file, mod)
    const snippet = (node: t.Node) => code.slice(node.start ?? 0, node.end ?? 0).slice(0, 400)
    const localId = (name: string, start: number | null | undefined) =>
      `${file}#${name}@${start ?? 0}`
    const ownerOf = (p: NodePath): string => {
      let current: NodePath | null = p
      while (current) {
        if (current.isFunctionDeclaration() && current.node.id) return current.node.id.name
        if (current.isVariableDeclarator() && t.isIdentifier(current.node.id))
          return current.node.id.name
        if (current.isClassDeclaration() && current.node.id) return current.node.id.name
        current = current.parentPath
      }
      return '<module>'
    }
    const ref = (node: t.Node, p: NodePath, seen = new Set<string>()): string => {
      node = clean(node)
      if (t.isStringLiteral(node)) return `native:${node.value}`
      if (t.isJSXIdentifier(node) && /^[a-z]/.test(node.name)) return `native:${node.name}`
      if (t.isIdentifier(node) || t.isJSXIdentifier(node)) {
        const binding = p.scope.getBinding(node.name)
        if (!binding) return `unknown:${file}:${p.node.loc?.start.line}:${node.name}`
        const b = binding.path
        if (
          b.isImportSpecifier() ||
          b.isImportDefaultSpecifier() ||
          b.isImportNamespaceSpecifier()
        ) {
          const imp = b.parentPath
          if (!imp.isImportDeclaration()) return `unknown:${file}:${node.name}`
          const imported = `${moduleRef(file, imp.node.source.value)}#${b.isImportSpecifier() ? key(b.node.imported) : b.isImportDefaultSpecifier() ? 'default' : '*'}`
          if (!immutable(binding)) staticInputs.unsafe.add(imported)
          if (
            binding.referencePaths.some((reference) => {
              let q = reference
              while (q.parentPath?.isMemberExpression() && q.parentPath.get('object') === q)
                q = q.parentPath
              const parent = q.parentPath
              return (
                (parent?.isAssignmentExpression() && parent.get('left') === q) ||
                parent?.isUpdateExpression() ||
                parent?.isUnaryExpression({ operator: 'delete' })
              )
            })
          )
            mutatedImports.add(imported)
          return imported
        }
        const id = localId(node.name, b.node.start)
        if (seen.has(id)) return id
        if (!symbols.has(id)) {
          symbols.set(id, { kind: 'unknown', targets: [], file, name: node.name })
          if (b.isFunctionDeclaration()) {
            if (binding.constant) staticInputs.functions.set(id, functionResult(b, ref))
            symbols.set(id, {
              kind: 'renderer',
              targets: functionTargets(b),
              file,
              name: node.name,
              polymorphic: polymorphic(b),
            })
          } else if (b.isVariableDeclarator() && b.node.init && binding.constant) {
            const initial = clean(b.node.init)
            const primitive = (n: t.Node): boolean =>
              t.isStringLiteral(n) ||
              t.isNumericLiteral(n) ||
              t.isBooleanLiteral(n) ||
              t.isNullLiteral(n) ||
              t.isTemplateLiteral(n) ||
              (t.isConditionalExpression(n) && primitive(n.consequent) && primitive(n.alternate))
            if (primitive(initial) || immutable(binding))
              staticInputs.values.set(id, expression(initial, b, ref))
            const init = b.get('init') as NodePath
            const fn = unwrapFunction(init)
            if (fn) {
              if (t.isArrowFunctionExpression(initial) || t.isFunctionExpression(initial))
                staticInputs.functions.set(id, functionResult(fn, ref))
              symbols.set(id, {
                kind: 'renderer',
                targets: functionTargets(fn),
                file,
                name: node.name,
                polymorphic: polymorphic(fn),
              })
            } else if (
              t.isIdentifier(clean(b.node.init)) ||
              t.isMemberExpression(clean(b.node.init)) ||
              t.isConditionalExpression(clean(b.node.init)) ||
              t.isStringLiteral(clean(b.node.init))
            )
              symbols.set(id, {
                kind: 'alias',
                targets: expressionTargets(init, new Set(seen).add(id)),
                file,
                name: node.name,
              })
            else if (t.isObjectExpression(initial) && immutable(binding)) {
              symbols.set(id, { kind: 'other', targets: [], file, name: node.name })
              for (const member of initial.properties) {
                if (t.isObjectProperty(member) && !member.computed)
                  symbols.set(`${id}.${key(member.key)}`, {
                    kind: 'alias',
                    targets: [ref(member.value, b)],
                    file,
                    name: key(member.key),
                  })
              }
            } else if (!t.isCallExpression(clean(b.node.init)))
              symbols.set(id, { kind: 'other', targets: [], file, name: node.name })
          }
        }
        return id
      }
      if (t.isJSXMemberExpression(node) || (t.isMemberExpression(node) && !node.computed)) {
        const base = ref(node.object, p, seen)
        const member = base.endsWith('#*')
          ? `${base.slice(0, -1)}${key(node.property)}`
          : `${base}.${key(node.property)}`
        if (staticInputs.unsafe.has(base)) staticInputs.unsafe.add(member)
        return member
      }
      return `unknown:${file}:${p.node.loc?.start.line}:${snippet(node)}`
    }
    const unwrapFunction = (p: NodePath): NodePath<t.Function> | undefined => {
      if (p.isFunction()) return p
      if (p.isTSAsExpression() || p.isTSSatisfiesExpression())
        return unwrapFunction(p.get('expression') as NodePath)
      if (p.isCallExpression()) {
        const r = ref(p.node.callee, p)
        if (
          [
            '!react#memo',
            '!react#forwardRef',
            '!react#default.memo',
            '!react#default.forwardRef',
          ].includes(r)
        ) {
          const arg = p.get('arguments')[0]
          if (arg) return unwrapFunction(arg)
        }
      }
      return undefined
    }
    const propsExpression = (p: NodePath<t.JSXElement>): Expr => ({
      kind: 'object',
      entries: p.node.openingElement.attributes.map((a) =>
        t.isJSXSpreadAttribute(a)
          ? { spread: expression(a.argument, p, ref) }
          : {
              key: key(a.name),
              value: expression(
                t.isJSXExpressionContainer(a.value) ? a.value.expression : (a.value ?? undefined),
                p,
                ref
              ),
            }
      ),
    })
    const childrenTargets = (p: NodePath<t.JSXElement> | NodePath<t.JSXFragment>): string[] =>
      (p.get('children') as NodePath[]).flatMap((c) => {
        if (c.isJSXText()) return c.node.value.trim() ? ['noncontrol:text'] : []
        if (c.isJSXExpressionContainer()) {
          if (t.isIdentifier(c.node.expression, { name: 'children' })) {
            const binding = c.scope.getBinding('children')
            if (binding?.kind === 'param') return ['noncontrol:forwarded-children']
          }
          if (t.isStringLiteral(c.node.expression)) return ['noncontrol:text']
          return expressionTargets(c.get('expression') as NodePath)
        }
        return expressionTargets(c as NodePath)
      })
    const polymorphic = (fn: NodePath<t.Function>): SymbolInfo['polymorphic'] => {
      const first = fn.node.params[0]
      if (!t.isObjectPattern(first)) return undefined
      let result: SymbolInfo['polymorphic']
      fn.traverse({
        VariableDeclarator(q) {
          if (
            q.getFunctionParent() !== fn ||
            !t.isConditionalExpression(q.node.init) ||
            !t.isIdentifier(q.node.init.test) ||
            !t.isIdentifier(q.node.id)
          )
            return
          const name = q.node.init.test.name
          const prop = first.properties.find(
            (a) =>
              t.isObjectProperty(a) &&
              (t.isIdentifier(a.value, { name }) ||
                (t.isAssignmentPattern(a.value) && t.isIdentifier(a.value.left, { name })))
          )
          if (!prop || !t.isObjectProperty(prop)) return
          const binding = q.scope.getBinding(q.node.id.name)
          if (
            !binding?.constant ||
            !binding.referencePaths.every(
              (r) =>
                r.isJSXIdentifier() ||
                r.parentPath?.isJSXOpeningElement() ||
                r.parentPath?.isJSXClosingElement()
            )
          )
            return
          const yes = ref(q.node.init.consequent, q)
          const no = ref(q.node.init.alternate, q)
          if (yes !== '!@radix-ui/react-slot#Slot' || no !== 'native:button') return
          const componentName = q.node.id.name
          const roots: t.Node[] = []
          const body = fn.get('body') as NodePath
          if (body.isBlockStatement())
            body.traverse({
              ReturnStatement(r) {
                if (r.getFunctionParent() === fn && r.node.argument) roots.push(r.node.argument)
              },
            })
          else roots.push(body.node)
          const rest = first.properties.find(
            (a) => t.isRestElement(a) && t.isIdentifier(a.argument)
          )
          if (!rest || !t.isRestElement(rest) || !t.isIdentifier(rest.argument) || !roots.length)
            return
          const restName = rest.argument.name
          if (
            !roots.every(
              (r) =>
                t.isJSXElement(r) &&
                t.isJSXIdentifier(r.openingElement.name, { name: componentName }) &&
                r.openingElement.attributes.some(
                  (a) => t.isJSXSpreadAttribute(a) && t.isIdentifier(a.argument, { name: restName })
                )
            )
          )
            return
          let styled = false
          const handlers = new Set<string>()
          fn.traverse({
            JSXOpeningElement(r) {
              if (t.isJSXIdentifier(r.node.name, { name: componentName }))
                for (const attr of r.node.attributes)
                  if (
                    t.isJSXAttribute(attr) &&
                    /^on(?:Click|DoubleClick|Pointer|Mouse|Key|Focus|Blur)/.test(key(attr.name))
                  )
                    handlers.add(key(attr.name))
              if (
                t.isJSXIdentifier(r.node.name, { name: componentName }) &&
                r.node.attributes.some((a) => t.isJSXAttribute(a) && key(a.name) === 'className')
              )
                styled = true
            },
          })
          result = {
            prop: key(prop.key),
            fallback: t.isAssignmentPattern(prop.value)
              ? expression(prop.value.right, fn, ref)
              : { kind: 'undefined' },
            yes,
            no,
            styled,
            handlers: [...handlers].sort(compare),
          }
        },
      })
      return result
    }
    const expressionTargets = (p: NodePath, seen = new Set<string>()): string[] => {
      if (p.isJSXElement()) {
        const target = ref(p.node.openingElement.name, p)
        if (target.startsWith('native:')) {
          const attrs: Record<string, ControlInput> = {}
          for (const a of p.node.openingElement.attributes) {
            if (!t.isJSXAttribute(a) || !['role', 'type'].includes(key(a.name))) continue
            attrs[key(a.name)] = value(
              t.isJSXExpressionContainer(a.value) ? a.value.expression : (a.value ?? undefined),
              p
            )
          }
          const semantic = attrs.role?.values?.filter((v) => roles.has(String(v)))
          if (semantic?.length) return semantic.map((v) => `semantic:${v}`)
          const kind = nativeRole(target.slice(7), attrs)
          if (kind) return [target === 'native:input' ? 'native:input-control' : target]
          if (attrs.role?.unresolved) {
            const attribute = p.node.openingElement.attributes.find(
              (a) => t.isJSXAttribute(a) && key(a.name) === 'role'
            )
            if (
              attribute &&
              t.isJSXAttribute(attribute) &&
              t.isJSXExpressionContainer(attribute.value) &&
              t.isIdentifier(attribute.value.expression)
            ) {
              const roleName = attribute.value.expression.name
              const b = p.scope.getBinding(roleName)
              const fn = p.getFunctionParent()
              if (b?.kind === 'param' && fn && t.isObjectPattern(fn.node.params[0])) {
                const param = fn.node.params[0].properties.find(
                  (a) => t.isObjectProperty(a) && t.isIdentifier(a.value, { name: roleName })
                )
                if (param && t.isObjectProperty(param)) return [`dynamic-role:${key(param.key)}`]
              }
            }
          }
          if (attrs.role?.unresolved || (target === 'native:input' && attrs.type?.unresolved))
            return [`unknown:dynamic native control semantics:${file}:${p.node.loc?.start.line}`]
          if (target === 'native:input') return ['noncontrol:text-input']
        }
        if (target.startsWith('native:')) return [target]
        // A context provider forwards children; it is not itself a control.
        if (
          t.isJSXMemberExpression(p.node.openingElement.name) &&
          p.node.openingElement.name.property.name === 'Provider' &&
          t.isJSXIdentifier(p.node.openingElement.name.object)
        ) {
          const b = p.scope.getBinding(p.node.openingElement.name.object.name)
          if (
            b?.constant &&
            b.path.isVariableDeclarator() &&
            t.isCallExpression(b.path.node.init) &&
            ['!react#createContext', '!react#default.createContext'].includes(
              ref(b.path.node.init.callee, b.path)
            )
          )
            return childrenTargets(p)
        }
        const id = `render:${file}:${p.node.start}`
        renderUses.set(id, { target, props: propsExpression(p), children: childrenTargets(p) })
        return [id]
      }
      if (p.isJSXFragment()) {
        const children = childrenTargets(p)
        return children.length === 1 && children[0] === 'noncontrol:forwarded-children'
          ? children
          : ['noncontrol:composition']
      }
      if (p.isConditionalExpression())
        return [
          ...expressionTargets(p.get('consequent'), seen),
          ...expressionTargets(p.get('alternate'), seen),
        ]
      if (p.isLogicalExpression())
        return [
          ...(p.node.operator === '&&' ? [] : expressionTargets(p.get('left'), seen)),
          ...expressionTargets(p.get('right'), seen),
        ]
      if (p.isNullLiteral() || p.isBooleanLiteral()) return []
      if (p.isCallExpression() && ref(p.node.callee, p) === '!react-dom#createPortal') {
        const child = p.get('arguments')[0]
        return child ? expressionTargets(child as NodePath) : ['unknown:portal content']
      }
      if (
        p.isCallExpression() &&
        ['!react#createElement', '!react#default.createElement'].includes(ref(p.node.callee, p))
      ) {
        const arg = p.node.arguments[0]
        const target = arg ? ref(arg, p) : 'unknown:createElement target'
        return [
          target === 'native:input'
            ? 'unknown:createElement input type/role requires analysis'
            : target,
        ]
      }
      if (p.isTSAsExpression() || p.isTSSatisfiesExpression())
        return expressionTargets(p.get('expression') as NodePath, seen)
      if (p.isIdentifier() || p.isMemberExpression() || p.isStringLiteral())
        return [ref(p.node, p, seen)]
      return [`unknown:${file}:${p.node.loc?.start.line}:rendered output`]
    }
    const functionTargets = (p: NodePath<t.Function>): string[] => {
      const body = p.get('body') as NodePath
      if (!body.isBlockStatement()) return expressionTargets(body)
      const targets: string[] = []
      body.traverse({
        ReturnStatement(q) {
          if (q.getFunctionParent() === p && q.node.argument)
            targets.push(...expressionTargets(q.get('argument') as NodePath))
        },
      })
      return [...new Set(targets)].sort(compare)
    }
    const value = (
      node: t.Node | undefined,
      p: NodePath,
      depth = 0,
      seen = new Set<string>()
    ): ControlInput => {
      if (!node) return { expression: 'true', values: [true], unresolved: false }
      const expression = snippet(node)
      node = clean(node)
      if (depth > 20) return { expression, unresolved: true }
      if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
        return { expression, values: [node.value], unresolved: false }
      if (t.isNullLiteral(node)) return { expression, values: [null], unresolved: false }
      if (t.isConditionalExpression(node)) {
        const a = value(node.consequent, p, depth + 1, seen)
        const b = value(node.alternate, p, depth + 1, seen)
        return {
          expression,
          values: [...new Set([...(a.values ?? []), ...(b.values ?? [])])],
          unresolved: a.unresolved || b.unresolved,
        }
      }
      if (t.isTemplateLiteral(node) && !node.expressions.length)
        return {
          expression,
          values: [node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')],
          unresolved: false,
        }
      if (t.isIdentifier(node)) {
        const b = p.scope.getBinding(node.name)
        const id = ref(node, p)
        if (!seen.has(id) && b?.constant && b.path.isVariableDeclarator() && b.path.node.init)
          return {
            ...value(b.path.node.init, b.path, depth + 1, new Set(seen).add(id)),
            expression,
          }
      }
      return { expression, unresolved: true }
    }
    const recipeRefs = (node: t.Node, p: NodePath): string[] => {
      const refs = new Set<string>()
      const visit = (e: Expr) => {
        if (e.kind === 'ref') refs.add(e.ref)
        if (e.kind === 'call') {
          refs.add(e.ref)
          e.args.forEach(visit)
        }
        if (e.kind === 'choice') e.choices.forEach(visit)
        if (e.kind === 'template') e.parts.forEach(visit)
        if (e.kind === 'member') visit(e.object)
        if (e.kind === 'object') e.entries.forEach((a) => visit('key' in a ? a.value : a.spread))
      }
      visit(expression(node, p, ref))
      return [...refs].sort(compare)
    }
    const addUse = (
      p: NodePath,
      target: t.Node,
      attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[] | t.ObjectExpression,
      syntax: 'jsx' | 'create-element'
    ) => {
      const inputs: Record<string, ControlInput> = {}
      const handlers: string[] = []
      const recipes: string[] = []
      let spread = false
      let hidden = false
      const set = (name: string, node: t.Node | undefined) => {
        if (attributes.has(name)) inputs[name] = value(node, p)
        if (/^on(?:Click|DoubleClick|Pointer|Mouse|Key|Change|Select)/.test(name))
          handlers.push(name)
        if (name === 'hidden') {
          const input = value(node, p)
          hidden =
            !input.unresolved &&
            !!input.values?.length &&
            input.values.every((v) => v === true || v === '')
        }
        if (node && ['className', 'style'].includes(name)) recipes.push(...recipeRefs(node, p))
      }
      const object = (node: t.Node, depth = 0, seen = new Set<string>()) => {
        node = clean(node)
        if (depth > 20) {
          spread = true
          return
        }
        if (t.isIdentifier(node)) {
          const b = p.scope.getBinding(node.name)
          if (
            !seen.has(node.name) &&
            b?.constant &&
            b.path.isVariableDeclarator() &&
            b.path.node.init
          ) {
            object(b.path.node.init, depth + 1, new Set(seen).add(node.name))
            return
          }
        }
        if (!t.isObjectExpression(node)) {
          spread = true
          for (const v of Object.values(inputs)) v.unresolved = true
          return
        }
        for (const a of node.properties) {
          if (t.isSpreadElement(a)) object(a.argument, depth + 1, seen)
          else if (t.isObjectProperty(a) && !a.computed) set(key(a.key), a.value)
          else spread = true
        }
      }
      if (Array.isArray(attrs))
        for (const a of attrs) {
          if (t.isJSXSpreadAttribute(a)) object(a.argument)
          else
            set(
              key(a.name),
              t.isJSXExpressionContainer(a.value) ? a.value.expression : (a.value ?? undefined)
            )
        }
      else object(attrs)
      const tag =
        t.isJSXIdentifier(target) ||
        t.isJSXMemberExpression(target) ||
        t.isJSXNamespacedName(target)
          ? jsxName(target)
          : snippet(target)
      const id = hash(canonical([file, p.node.start, syntax]))
      inputExpressions.set(
        id,
        Array.isArray(attrs)
          ? {
              kind: 'object',
              entries: attrs.map((a) =>
                t.isJSXSpreadAttribute(a)
                  ? { spread: expression(a.argument, p, ref) }
                  : {
                      key: key(a.name),
                      value: expression(
                        t.isJSXExpressionContainer(a.value)
                          ? a.value.expression
                          : (a.value ?? undefined),
                        p,
                        ref
                      ),
                    }
              ),
            }
          : expression(attrs, p, ref)
      )
      if (p.isJSXElement()) {
        hooks?.jsx?.({ id, file, owner: ownerOf(p), path: p, reference: ref })
        expressionTargets(p)
        renderUses.set(`use:${id}`, {
          target: ref(target, p),
          props: inputExpressions.get(id) ?? unknown,
          children: childrenTargets(p),
        })
      }
      const slotNodes = Array.isArray(attrs) ? attrs : attrs.properties
      raw.push({
        id,
        file,
        line: p.node.loc?.start.line ?? 1,
        column: (p.node.loc?.start.column ?? 0) + 1,
        endLine:
          (p.isJSXElement() ? p.node.openingElement.loc?.end.line : p.node.loc?.end.line) ?? 1,
        endColumn:
          ((p.isJSXElement() ? p.node.openingElement.loc?.end.column : p.node.loc?.end.column) ??
            0) + 1,
        slots: slotNodes.map((a) => ({
          name: t.isJSXAttribute(a) ? key(a.name) : t.isObjectProperty(a) ? key(a.key) : 'spread',
          line: a.loc?.start.line ?? 1,
          column: (a.loc?.start.column ?? 0) + 1,
          endLine: a.loc?.end.line ?? 1,
          endColumn: (a.loc?.end.column ?? 0) + 1,
        })),
        owner: ownerOf(p),
        target: ref(target, p),
        tag,
        syntax,
        inputs,
        spread,
        handlers: handlers.sort(compare),
        repeated: !!p.findParent(
          (q) =>
            q.isCallExpression() &&
            t.isMemberExpression(q.node.callee) &&
            ['map', 'flatMap'].includes(key(q.node.callee.property))
        ),
        recipes: [...new Set(recipes)].sort(compare),
        hidden,
      })
    }
    const dom = inspectImperative(ast, value, ownerOf)
    for (const control of dom.controls)
      raw.push({
        id: hash(canonical([file, control.start, 'imperative'])),
        file,
        line: control.line,
        column: control.column,
        endLine: control.line,
        owner: control.owner,
        target: `native:${control.tag}`,
        tag: control.tag,
        syntax: 'imperative',
        inputs: control.inputs,
        spread: false,
        handlers: control.handlers,
        repeated: false,
        recipes: [],
        hidden: false,
        constructionEvidence: control.attachment,
      })
    traverse(ast, {
      Program(p) {
        hooks?.program?.({ file, path: p, reference: ref })
      },
      ExportNamedDeclaration(p) {
        if (p.node.source)
          for (const s of p.node.specifiers) {
            if (t.isExportSpecifier(s))
              mod.exports.set(
                key(s.exported),
                `${moduleRef(file, p.node.source.value)}#${key(s.local)}`
              )
            else if (t.isExportNamespaceSpecifier(s))
              mod.exports.set(key(s.exported), `${moduleRef(file, p.node.source.value)}#*`)
          }
        else {
          for (const s of p.node.specifiers)
            if (t.isExportSpecifier(s)) mod.exports.set(key(s.exported), ref(s.local, p))
          const d = p.node.declaration
          if (t.isFunctionDeclaration(d) && d.id) mod.exports.set(d.id.name, ref(d.id, p))
          if (t.isVariableDeclaration(d))
            for (const v of d.declarations)
              if (t.isIdentifier(v.id)) mod.exports.set(v.id.name, ref(v.id, p))
        }
      },
      ExportAllDeclaration(p) {
        mod.stars.push(moduleRef(file, p.node.source.value))
      },
      ExportDefaultDeclaration(p) {
        const d = p.get('declaration')
        if (
          d.isFunctionDeclaration() ||
          d.isFunctionExpression() ||
          d.isArrowFunctionExpression()
        ) {
          const id = localId('default', d.node.start)
          symbols.set(id, { kind: 'renderer', targets: functionTargets(d), file, name: 'default' })
          mod.exports.set('default', id)
        } else if (d.isIdentifier()) mod.exports.set('default', ref(d.node, d))
        else {
          const fn = unwrapFunction(d)
          const id = localId('default', d.node.start)
          symbols.set(id, {
            kind: fn ? 'renderer' : 'unknown',
            targets: fn ? functionTargets(fn) : [],
            file,
            name: 'default',
          })
          mod.exports.set('default', id)
        }
      },
      JSXElement(p) {
        addUse(p, p.node.openingElement.name, p.node.openingElement.attributes, 'jsx')
      },
      CallExpression(p) {
        const callee = ref(p.node.callee, p)
        if (
          callee === '!class-variance-authority#cva' &&
          p.parentPath.isVariableDeclarator() &&
          t.isIdentifier(p.parentPath.node.id)
        ) {
          if (p.node.arguments[0])
            for (const base of recipeRefs(p.node.arguments[0], p)) recipeBases.add(base)
          const config = p.node.arguments[1]
          if (t.isObjectExpression(config)) {
            hooks?.recipe?.(
              ref(p.parentPath.node.id, p.parentPath),
              expression(p.node.arguments[0], p, ref),
              expression(config, p, ref)
            )
            const d = config.properties.find(
              (a) => t.isObjectProperty(a) && key(a.key) === 'defaultVariants'
            )
            if (d && t.isObjectProperty(d))
              defaults.set(ref(p.parentPath.node.id, p.parentPath), expression(d.value, p, ref))
          }
        }
        if (['!react#createElement', '!react#default.createElement'].includes(callee)) {
          const [target, props] = p.node.arguments
          if (target)
            addUse(
              p,
              target,
              t.isObjectExpression(props)
                ? props
                : t.objectExpression(
                    props && !t.isNullLiteral(props) ? [t.spreadElement(props as t.Expression)] : []
                  ),
              'create-element'
            )
        }
        if (
          t.isMemberExpression(p.node.callee) &&
          ['createElement', 'createElementNS', 'insertAdjacentHTML', 'write', 'writeln'].includes(
            key(p.node.callee.property)
          ) &&
          !callee.startsWith('!react') &&
          !dom.handled.has(p.node.start ?? 0)
        )
          note(
            file,
            p.node.loc?.start.line ?? 1,
            ownerOf(p),
            'Imperative DOM/HTML construction requires analysis; not executed or silently classified'
          )
      },
      JSXAttribute(p) {
        if (key(p.node.name) === 'dangerouslySetInnerHTML') {
          const sink = htmlSink(p)
          if (sink) {
            if (nonUiScript(sink)) {
              nonUi.push({
                file,
                line: p.node.loc?.start.line ?? 1,
                context: ownerOf(p),
                reason:
                  'Non-UI script: one global data assignment using literal JSON or a proven HTML-safe JSON serializer',
              })
              return
            }
            if (
              p.parentPath.isJSXOpeningElement() &&
              t.isJSXIdentifier(p.parentPath.node.name, { name: 'script' })
            ) {
              note(
                file,
                p.node.loc?.start.line ?? 1,
                ownerOf(p),
                'Script HTML sink is not proven data-only; UI construction remains unchecked'
              )
              return
            }
            const result = value(sink.node, sink)
            if (!result.unresolved && result.values?.every((v) => typeof v === 'string'))
              for (const v of result.values)
                addHtml(String(v), sink.node.loc?.start.line ?? 1, `${ownerOf(p)}:html`)
            else
              note(
                file,
                p.node.loc?.start.line ?? 1,
                ownerOf(p),
                'Runtime HTML sink: exact control inventory unavailable'
              )
          } else note(file, p.node.loc?.start.line ?? 1, ownerOf(p), 'Unresolved HTML sink')
        }
        if (key(p.node.name) === 'srcDoc')
          note(
            file,
            p.node.loc?.start.line ?? 1,
            ownerOf(p),
            'Iframe source document needs a separate HTML inventory'
          )
      },
      AssignmentExpression(p) {
        if (
          t.isMemberExpression(p.node.left) &&
          ['innerHTML', 'outerHTML'].includes(key(p.node.left.property)) &&
          !dom.handled.has(p.node.start ?? 0)
        )
          note(
            file,
            p.node.loc?.start.line ?? 1,
            ownerOf(p),
            'Imperative HTML assignment requires separate analysis'
          )
      },
    })
    for (const [at, reason] of dom.handled)
      if (reason.startsWith('Decorative') || reason.startsWith('Literal decorative'))
        nonUi.push({
          file,
          line: code.slice(0, at).split('\n').length,
          context: 'imperative DOM',
          reason,
        })
  }
  const resolveExport = (ref: string, seen = new Set<string>()): string[] => {
    if (
      mutatedImports.has(ref) ||
      mutatedImports.has(
        ref.slice(0, ref.indexOf('#') + 1) + ref.slice(ref.indexOf('#') + 1).split('.')[0]
      ) ||
      mutatedImports.has(`${ref.slice(0, ref.indexOf('#'))}#*`)
    )
      return [`unknown:mutated imported binding:${ref}`]
    if (
      symbols.has(ref) ||
      renderUses.has(ref) ||
      ref.startsWith('native:') ||
      ref.startsWith('unknown:') ||
      ref.startsWith('noncontrol:') ||
      ref.startsWith('semantic:') ||
      ref.startsWith('!')
    )
      return [ref]
    if (seen.has(ref) || seen.size > 100) return [`unknown:export cycle or limit:${ref}`]
    const at = ref.indexOf('#')
    const file = ref.slice(0, at)
    const name = ref.slice(at + 1)
    const mod = modules.get(file)
    if (!mod) return [`unknown:unavailable module:${ref}`]
    const next = new Set(seen).add(ref)
    if (name.includes('.')) {
      const [base, ...members] = name.split('.')
      const bases = resolveExport(`${file}#${base}`, next)
      return bases.flatMap((b) => {
        const info = symbols.get(b)
        const targets = info?.kind === 'alias' ? info.targets : [b]
        return targets.flatMap((target) => resolveExport(`${target}.${members.join('.')}`, next))
      })
    }
    const own = mod.exports.get(name)
    if (own) return resolveExport(own, next)
    const found = [
      ...new Set(
        mod.stars
          .flatMap((star) => resolveExport(`${star}#${name}`, next))
          .filter((r) => !r.startsWith('unknown:'))
      ),
    ]
    return found.length === 1
      ? found
      : [`unknown:${found.length ? 'ambiguous' : 'missing'} export:${ref}`]
  }
  const cache = new Map<string, Proof>()
  const prove = (
    ref: string,
    seen = new Set<string>(),
    props?: Expr,
    children?: string[]
  ): Proof => {
    const cached = !props && !children ? cache.get(ref) : undefined
    if (cached) return cached
    const out = emptyProof()
    if (seen.has(ref) || seen.size > 100) {
      out.unknown.add(`Renderer cycle or limit: ${ref}`)
      return out
    }
    const next = new Set(seen).add(ref)
    if (renderUses.has(ref)) {
      const use = renderUses.get(ref)
      if (!use) throw new Error('Missing render expression')
      return prove(use.target, next, use.props, use.children)
    }
    if (ref.startsWith('dynamic-role:')) {
      const role = props
        ? staticInputs.evaluate(staticInputs.property(props, ref.slice(13)))
        : undefined
      if (!role || role.unknown) out.unknown.add('Native role remains unresolved')
      else
        for (const v of role.values)
          if (typeof v === 'string' && roles.has(v)) out.controls.add(`semantic:${v}`)
    } else if (ref.startsWith('unknown:') || ref.startsWith('?')) out.unknown.add(ref)
    else if (ref.startsWith('native:')) {
      const tag = ref.slice(7)
      if (['button', 'a', 'input-control', 'select', 'summary', 'textarea'].includes(tag))
        out.controls.add(ref)
    } else if (ref.startsWith('semantic:')) out.controls.add(ref)
    else if (ref.startsWith('!')) {
      const [module, name] = ref.slice(1).split('#')
      if (module === 'next/link' || (module === 'next' && name === 'Link')) out.controls.add(ref)
      else if (
        (/^@radix-ui\/react-(?:dropdown-menu|context-menu|menubar|select|tabs|radio-group|toggle-group|checkbox|switch|toggle|button)/.test(
          module
        ) &&
          /^(?:Item|Trigger|SubTrigger|CheckboxItem|RadioItem|Link|Close)$/.test(name)) ||
        (/^@radix-ui\/react-(?:checkbox|switch|toggle)$/.test(module) && name === 'Root') ||
        (module === 'cmdk' && /Item$/.test(name))
      )
        out.controls.add(ref)
      else if (!/^(?:react|lucide-react|@sim\/emcn\/icons)$/.test(module))
        out.unknown.add(`External renderer: ${ref}`)
    } else if (symbols.has(ref)) {
      const info = symbols.get(ref)
      if (!info) throw new Error(`Missing indexed symbol: ${ref}`)
      if (info.polymorphic) {
        const poly = info.polymorphic
        out.implementations.add(ref)
        for (const handler of poly.handlers) out.handlers.add(handler)
        const supplied = props
          ? staticInputs.property(props, poly.prop)
          : ({ kind: 'unknown' } as Expr)
        const rawInput = staticInputs.evaluate(supplied)
        const fallback = staticInputs.evaluate(poly.fallback)
        const values = [...rawInput.values, ...(rawInput.undefined ? fallback.values : [])]
        if (values.includes(false)) merge(out, prove(poly.no, next))
        if (values.includes(true)) {
          if (children?.length === 1) {
            merge(out, prove(children[0], next))
            out.relationships.add('delegates-to-child')
          } else out.unknown.add('asChild requires one statically identified child')
        }
        if (rawInput.unknown) {
          merge(out, prove(poly.no, next))
          if (children?.length === 1) merge(out, prove(children[0], next))
        }
        if (rawInput.unknown || !values.length || values.some((v) => typeof v !== 'boolean'))
          out.unknown.add('Polymorphic asChild alternative remains unresolved')
        if (poly.styled) out.stylingOwners.add(ref)
        out.relationships.add('polymorphic-renderer')
      } else if (info.targets.includes('noncontrol:forwarded-children')) {
        out.relationships.add('surrounds-children')
        if (!children) out.unknown.add('Forwarded children unavailable at this use')
        else {
          const proofs = children.map((c) => prove(c, next))
          if (
            proofs.filter((p) => p.controls.size).length === 1 &&
            proofs.every((p) => !p.unknown.size)
          ) {
            for (const p of proofs) merge(out, p)
          } else if (proofs.filter((p) => p.controls.size).length > 1)
            out.relationships.add('composition')
          else for (const p of proofs) for (const u of p.unknown) out.unknown.add(u)
        }
      } else if (info.kind === 'unknown') out.unknown.add(`Unsupported renderer: ${ref}`)
      else for (const target of info.targets) merge(out, prove(target, next, props, children))
      if (out.controls.size) {
        out.implementations.add(ref)
        if (
          info.file.startsWith('packages/emcn/') &&
          !info.polymorphic &&
          !out.relationships.has('surrounds-children')
        ) {
          out.central.add(ref)
          if (!out.unknown.size) {
            out.controls.clear()
            out.controls.add(`central:${ref}`)
          }
        }
      }
    } else if (!ref.startsWith('noncontrol:'))
      for (const target of resolveExport(ref)) merge(out, prove(target, next, props, children))
    /** Cache only context-independent proofs; a cycle cannot gain approval via traversal order. */
    if (!out.unknown.size && !props && !children) cache.set(ref, out)
    return out
  }
  const recipeBaseTargets = new Set([...recipeBases].flatMap((r) => resolveExport(r)))
  const rawById = new Map(raw.map((r) => [r.id, r]))
  const sourceRef = (r: string) => r.replace(/@\d+(?=\.|$)/g, '').replace(/\.[cm]?[jt]sx?(?=#)/, '')
  const associations = associateFindings(raw, findings, (id, slot) => {
    const use = rawById.get(id)
    if (!use) return []
    if (use.target.startsWith('native:')) return [use.target.slice(7)]
    const resolved = resolveExport(use.target)
    if (resolved.some((r) => r.startsWith('unknown:'))) return []
    const refs = resolved.map(sourceRef)
    const targets = refs.map((r) => sourceIndex?.canonicalTarget(r) ?? r)
    if (sourceIndex)
      for (const r of refs) targets.push(...sourceIndex.forwarded(r, slot).map((p) => p.target))
    for (const r of resolved) {
      const info = symbols.get(r)
      if (info?.file.startsWith('packages/emcn/')) targets.push(`@sim/emcn#${info.name}`)
    }
    return [...new Set([...targets, use.tag])]
  })
  const records: ControlRecord[] = []
  for (const use of raw.sort(
    (a, b) =>
      compare(a.file, b.file) || a.line - b.line || a.column - b.column || compare(a.id, b.id)
  )) {
    const props = inputExpressions.get(use.id)
    use.recipes = use.recipes.filter((r) =>
      resolveExport(r).some((x) => {
        const info = symbols.get(x)
        return (
          !!info &&
          info.file.startsWith('packages/emcn/') &&
          (defaults.has(x) ||
            centralReference?.(sourceRef(x))?.recipe === true ||
            (recipeBaseTargets.has(x) && centralReference?.(sourceRef(x))?.value !== undefined))
        )
      })
    )
    if (props)
      for (const name of attributes) {
        const expr = staticInputs.property(props, name)
        const resolved = staticInputs.input(
          expr,
          use.inputs[name]?.expression ?? '<spread or omitted>'
        )
        // Reuse the frozen index's scalar answer only when our lexical/immutability proof agrees.
        if (
          sourceIndex &&
          expr.kind === 'ref' &&
          !resolved.unresolved &&
          resolved.values?.length === 1
        ) {
          const shared = sourceIndex.value(sourceRef(expr.ref))
          if (typeof resolved.values[0] === 'string' && shared === resolved.values[0])
            resolved.values = [shared]
        }
        if (resolved.values?.length || use.inputs[name]) use.inputs[name] = resolved
      }
    if (props)
      use.spread = staticInputs.evaluate(
        staticInputs.property(props, '__unknown_spread_probe__')
      ).unknown
    const renderUse = renderUses.get(`use:${use.id}`)
    const proof = prove(use.target, new Set(), props, renderUse?.children)
    // CVA defaults come from source, and only direct renderer uses inherit them.
    for (const terminal of resolveExport(use.target)) {
      const info = symbols.get(terminal)
      if (!info?.file.startsWith('packages/emcn/')) continue
      const definitions = raw.filter((r) => r.file === info.file && r.owner === info.name)
      for (const definition of definitions)
        for (const recipe of definition.recipes)
          for (const r of resolveExport(recipe)) {
            const config = defaults.get(r)
            if (!config) continue
            for (const prop of Object.keys(
              staticInputs.input(config, 'central defaults').properties ?? {}
            )) {
              const d = staticInputs.input(staticInputs.property(config, prop), 'central default')
              if (!d.values?.length || d.unresolved) continue
              const input = use.inputs[prop] ?? {
                expression: '<omitted>',
                unresolved: use.spread,
                omitted: true,
                mayBeUndefined: true,
              }
              use.inputs[prop] = {
                ...input,
                effectiveValues: [
                  ...new Set([
                    ...(input.values ?? []),
                    ...(!input.unresolved && (input.mayBeUndefined || input.omitted)
                      ? d.values
                      : []),
                  ]),
                ],
                defaultSource: r,
              }
            }
          }
    }
    const native = use.target.startsWith('native:')
    const nativeKind = native ? nativeRole(use.target.slice(7), use.inputs) : undefined
    const candidate =
      !!nativeKind ||
      (proof.relationships.has('polymorphic-renderer') && proof.unknown.size > 0) ||
      proof.handlers.size > 0 ||
      (!native && proof.controls.size > 0) ||
      use.handlers.some((h) =>
        /^on(?:click|doubleclick|pointerdown|mousedown|keydown|keyup)$/i.test(h)
      ) ||
      (native && use.tag === 'input' && !!use.inputs.type?.unresolved) ||
      !!use.inputs.role?.unresolved ||
      !!use.inputs.tabIndex?.unresolved ||
      !!use.inputs.tabIndex?.values?.some((v) => Number(v) >= 0)
    if (!candidate) {
      if (use.spread)
        note(
          use.file,
          use.line,
          use.owner,
          'Unknown spread may supply interactive roles or handlers; control presence cannot be established'
        )
      if (!native && proof.unknown.size) {
        coverage.unknownComponentUses++
        note(use.file, use.line, use.owner, [...proof.unknown].sort(compare).join('; '))
      }
      continue
    }
    const central = use.file.startsWith('packages/emcn/')
    const uncertain =
      (!native && proof.unknown.size > 0) ||
      !!use.inputs.role?.unresolved ||
      (native && use.tag === 'input' && !!use.inputs.type?.unresolved)
    const origin: ControlRecord['origin'] = use.hidden
      ? 'nonvisual'
      : central
        ? 'central-implementation'
        : uncertain
          ? 'unresolved'
          : proof.central.size && [...proof.controls].some((c) => !c.startsWith('central:'))
            ? 'mixed-origin'
            : proof.central.size
              ? 'emcn-component'
              : proof.controls.size && [...proof.controls].every((c) => c.startsWith('!'))
                ? 'external-control'
                : !nativeKind && !proof.controls.size
                  ? 'interaction-candidate'
                  : 'local-control'
    const local = origin === 'local-control' || origin === 'mixed-origin'
    const related = associations.get(use.id) ?? { direct: [], potential: [] }
    const evidence = [...proof.central, ...proof.implementations, ...proof.unknown].sort(compare)
    if (use.constructionEvidence)
      evidence.push(
        `Literal DOM construction attached to: ${use.constructionEvidence.join(', ') || 'returned/document root'}`
      )
    if (proof.handlers.size)
      evidence.push(`Behavioral wrapper handlers: ${[...proof.handlers].sort(compare).join(', ')}`)
    if (nativeKind) evidence.push(`Native/semantic control: ${nativeKind}`)
    if (use.recipes.length)
      evidence.push(
        'Central recipe references need styling inspection; a recipe call alone does not establish complete component ownership'
      )
    if (use.spread)
      note(
        use.file,
        use.line,
        use.owner,
        'Control has unresolved spread inputs; origin may be known but effective appearance is not fully resolved'
      )
    for (const [name, input] of Object.entries(use.inputs))
      if (
        input.unresolved &&
        ['className', 'style', 'variant', 'size', 'shape', 'asChild', 'role', 'type'].includes(name)
      )
        note(
          use.file,
          use.line,
          use.owner,
          `Runtime or unsupported ${name} input: ${input.expression}`
        )
    for (const reason of proof.unknown) note(use.file, use.line, use.owner, reason)
    records.push({
      ...use,
      origin,
      inheritedHandlers: [...proof.handlers].sort(compare),
      evidence,
      terminals: [...proof.controls].sort(compare),
      authoredAt: [...proof.implementations].sort(compare),
      multiplicity: use.repeated ? 'repeated-source' : 'single-source',
      findingIds: related.direct,
      potentialFindingIds: related.potential,
      review: local
        ? 'Review local implementation; not automatically a violation or Extra'
        : origin === 'unresolved'
          ? 'Resolve analysis before judging conformance'
          : origin === 'emcn-component'
            ? 'EMCN renderer proven; styling findings and unresolved inputs are checked separately'
            : origin === 'interaction-candidate'
              ? 'Event/focus evidence only: classify whether this is a control before proposing a migration'
              : origin === 'nonvisual'
                ? 'Hidden control: review form/interaction purpose separately'
                : 'Inspect source evidence',
      area: areaOf(use.file),
      projection: !native && proof.implementations.size > 0,
      relationship: [...proof.relationships].sort(compare),
      stylingOwners: [...proof.stylingOwners].sort(compare),
      appearance: {
        status:
          use.spread ||
          Object.entries(use.inputs).some(
            ([name, i]) =>
              [
                'className',
                'class',
                'style',
                'variant',
                'size',
                'shape',
                'active',
                'disabled',
                'loading',
                'fullWidth',
              ].includes(name) && i.unresolved
          )
            ? 'unresolved'
            : 'resolved',
        centralRecipes: use.recipes.filter((r) =>
          resolveExport(r).some((x) => x.startsWith('packages/emcn/'))
        ),
        localInputs: !!use.inputs.className || !!use.inputs.style || proof.stylingOwners.size > 0,
      },
    })
  }
  // Wrapper reports include uncertainty at their governing authored controls.
  for (const record of records) {
    for (const implementation of record.authoredAt) {
      const info = symbols.get(implementation)
      if (!info || info.file.startsWith('packages/emcn/')) continue
      const authored = records.filter(
        (r) => r.file === info.file && r.owner === info.name && r.id !== record.id
      )
      if (authored.some((r) => r.appearance.status === 'unresolved'))
        record.appearance.status = 'unresolved'
    }
  }
  const counts: Record<string, number> = {}
  const byArea: Record<string, Record<string, number>> = {}
  for (const r of records) {
    counts[r.origin] = (counts[r.origin] ?? 0) + 1
    byArea[r.area] ??= {}
    byArea[r.area][r.origin] = (byArea[r.area][r.origin] ?? 0) + 1
  }
  hooks?.complete?.({ resolve: resolveExport, staticInputs, props: inputExpressions, uses: raw })
  return {
    version: 'control-origins/1.1.0',
    records,
    nonUi: nonUi.sort((a, b) => compare(canonical(a), canonical(b))),
    unchecked: [...notes.values()].sort((a, b) => compare(canonical(a), canonical(b))),
    coverage: { ...coverage, excludedFiles: coverage.excludedFiles.sort(compare) },
    counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compare(a, b))),
    byArea: Object.fromEntries(
      Object.entries(byArea)
        .sort(([a], [b]) => compare(a, b))
        .map(([a, c]) => [
          a,
          Object.fromEntries(Object.entries(c).sort(([x], [y]) => compare(x, y))),
        ])
    ),
    limitations: [
      'Records are authored source occurrences and wrapper projections, not counts of distinct visible controls. Unused declarations are included.',
      'Origin tracing follows exact lexical bindings, aliases, re-exports, React memo/forwardRef and direct root returns. Compositions are not treated as inheritance; their authored child controls are discovered separately.',
      'Central origin is not approval: local appearance inputs, unresolved spreads, conditional renderers and styling findings remain visible.',
      'Immutable imported constants/objects, templates, ordered spreads and finite alternatives are resolved with depth 20 and branch limit 64. Omitted/undefined inputs and source-backed CVA defaults remain distinct. Arbitrary factories, mutations, class renderers and runtime cascade remain unresolved.',
      'Literal HTML and locally attached literal DOM controls are inventoried. Proven decorative DOM and data-only script transports have separate non-UI evidence. Dynamic tags, escaping references, unknown factories, runtime HTML and iframe content retain diagnostics.',
      'Event handlers are candidates, not automatic button classifications. Native anchors include ordinary navigation links. No runtime reachability or full generated-screen coverage is claimed.',
      'Existing Extras are not inferred from names or folders. Decisions require an explicit source-bound record; this baseline has no authoritative Extra registry for this scanner.',
    ],
  }
}
