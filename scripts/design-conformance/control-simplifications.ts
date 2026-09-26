import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { type ARIARoleDefinitionKey, elementRoles, roles } from 'aria-query'
import { extendTailwindMerge } from 'tailwind-merge'
import {
  type ColourAssignmentReport,
  ColourAssignments,
} from '#control-analysis/colour-assignments'
import { type ControlInventory, inspectControls, type RawUse } from '#control-analysis/inventory'
import {
  type ControlHooks,
  type ControlSource,
  compare,
  type Diagnostic,
  type InventoryFinding,
} from '#control-analysis/model'
import { ReviewCollector, type ReviewReport } from '#control-analysis/review'
import { inspectShadowExtras, type ShadowExtrasReport } from '#control-analysis/shadow-extras'
import {
  type Expr,
  expression,
  type Scalar,
  type StaticInputs,
  unknown,
} from '#control-analysis/static-inputs'
import { inspectTypography, type TypographyReview } from '#control-analysis/typography'
import { artworkSyntax } from '#design-conformance/artwork'
import type { GeneratedContracts } from '#design-conformance/generated-contracts'
import { canonical, hash } from '#design-conformance/model'
import type { SourceIndex } from '#design-conformance/source-summary'

/** Reviewed EMCN cn AST: imports, implementation and declarative extension must still match. */
const MERGE_SOURCE = 'packages/emcn/src/lib/cn.ts'
const MERGE_AST = 'bb758ea44c62ab2303487cb6c0dfbce7d9537a966e61f1d18c05d1cdb3158109'
const mergeClasses = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['micro', 'caption', 'small', 'md'] }] } },
})
const tokens = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const tokenSet = (s: string) => canonical([...new Set(tokens(s))].sort(compare))
const name = (n: t.Node) =>
  t.isIdentifier(n) || t.isJSXIdentifier(n) ? n.name : t.isStringLiteral(n) ? n.value : ''

export interface Simplification extends InventoryFinding {
  rule: 'control-redundant-style' | 'control-accessible-name' | 'control-duplicate-artwork'
  proof: Record<string, unknown>
  relatedFindingIds: string[]
}
export interface SimplificationReport {
  version: '1.0.0'
  findings: Simplification[]
  unchecked: Diagnostic[]
  coverage: { controls: number; styleChecks: number; nameChecks: number; artwork: number }
}
type Content =
  | { kind: 'text'; value: Expr }
  | {
      kind: 'element'
      target: string
      props: Expr
      children: Content[]
      parameter?: { owner: string; key: string }
      forwarded?: { ref: string; omitted: string[] }
    }
  | { kind: 'choice'; children: Content[] }
  | { kind: 'unknown' }
interface Detail {
  id: string
  file: string
  owner: string
  content: Extract<Content, { kind: 'element' }>
  pipeline?: {
    recipe: string
    merger: string
    options: Expr
    parameters: Map<string, { key: string; fallback: Expr }>
  }
}
interface Artwork {
  file: string
  line: number
  column: number
  owner: string
  fingerprint: string
  central: boolean
  root: string
}
type Graph = Parameters<NonNullable<ControlHooks['complete']>>[0]
type Reference = Parameters<NonNullable<ControlHooks['jsx']>>[0]['reference']
const attributeValue = (a: t.JSXAttribute) =>
  t.isJSXExpressionContainer(a.value) ? a.value.expression : (a.value ?? undefined)

function propsOf(p: NodePath<t.JSXElement>, ref: Reference): Expr {
  return {
    kind: 'object',
    entries: p.node.openingElement.attributes.map((a) =>
      t.isJSXSpreadAttribute(a)
        ? { spread: expression(a.argument, p, ref) }
        : { key: name(a.name), value: expression(attributeValue(a), p, ref) }
    ),
  }
}

function contentOf(p: NodePath, ref: Reference, owner: string, depth = 0): Content {
  if (depth > 20) return { kind: 'unknown' }
  if (p.isJSXText()) return { kind: 'text', value: { kind: 'literal', value: p.node.value.trim() } }
  if (p.isJSXExpressionContainer()) return contentOf(p.get('expression'), ref, owner, depth + 1)
  if (p.isJSXEmptyExpression() || p.isNullLiteral() || p.isBooleanLiteral())
    return { kind: 'text', value: { kind: 'literal', value: '' } }
  if (p.isConditionalExpression())
    return {
      kind: 'choice',
      children: [
        contentOf(p.get('consequent'), ref, owner, depth + 1),
        contentOf(p.get('alternate'), ref, owner, depth + 1),
      ],
    }
  if (p.isLogicalExpression() && p.node.operator === '&&')
    return {
      kind: 'choice',
      children: [
        { kind: 'text', value: { kind: 'literal', value: '' } },
        contentOf(p.get('right'), ref, owner, depth + 1),
      ],
    }
  if (p.isJSXFragment())
    return {
      kind: 'element',
      target: 'native:fragment',
      props: { kind: 'object', entries: [] },
      children: p.get('children').map((c) => contentOf(c, ref, owner, depth + 1)),
    }
  if (!p.isJSXElement()) return { kind: 'text', value: expression(p.node, p, ref) }
  const tag = p.node.openingElement.name
  const fn = p.getFunctionParent()
  const first = fn?.node.params[0]
  let forwarded: { ref: string; omitted: string[] } | undefined
  if (t.isIdentifier(first)) forwarded = { ref: ref(first, p), omitted: [] }
  else if (t.isObjectPattern(first)) {
    const rest = first.properties.find((prop) => t.isRestElement(prop))
    if (rest && t.isRestElement(rest) && t.isIdentifier(rest.argument))
      forwarded = {
        ref: ref(rest.argument, p),
        omitted: first.properties.flatMap((prop) =>
          t.isObjectProperty(prop) ? [name(prop.key)] : []
        ),
      }
  }
  let parameter: { owner: string; key: string } | undefined
  if (t.isJSXIdentifier(tag)) {
    const binding = p.scope.getBinding(tag.name)
    if (binding?.kind === 'param' && t.isObjectPattern(first))
      for (const prop of first.properties)
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.value, { name: tag.name }))
          parameter = { owner, key: name(prop.key) }
  }
  return {
    kind: 'element',
    target: ref(tag, p),
    props: propsOf(p, ref),
    children: p.get('children').map((c) => contentOf(c, ref, owner, depth + 1)),
    ...(parameter ? { parameter } : {}),
    ...(forwarded ? { forwarded } : {}),
  }
}

/** Match the simple, direct cn(cva(options), className) renderer contract by syntax. */
function pipelineOf(p: NodePath<t.JSXElement>, ref: Reference): Detail['pipeline'] {
  const fn = p.getFunctionParent()
  if (!fn || !t.isObjectPattern(fn.node.params[0])) return
  const body = fn.node.body
  const returned =
    t.isBlockStatement(body) && body.body.length === 1 && t.isReturnStatement(body.body[0])
      ? body.body[0].argument
      : body
  if (returned !== p.node) return
  const parameters = new Map<string, { key: string; fallback: Expr }>()
  const first = fn.node.params[0]
  const rest = first.properties.find((prop) => t.isRestElement(prop))
  for (const prop of first.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) continue
    const local = t.isAssignmentPattern(prop.value) ? prop.value.left : prop.value
    if (t.isIdentifier(local))
      parameters.set(ref(local, p), {
        key: name(prop.key),
        fallback: t.isAssignmentPattern(prop.value)
          ? expression(prop.value.right, p, ref)
          : { kind: 'undefined' },
      })
  }
  for (const attr of p.node.openingElement.attributes)
    if (
      t.isJSXSpreadAttribute(attr) &&
      !(
        rest &&
        t.isRestElement(rest) &&
        t.isIdentifier(rest.argument) &&
        t.isIdentifier(attr.argument, { name: rest.argument.name })
      )
    )
      return
  const attrs = p.node.openingElement.attributes.filter(
    (a) => t.isJSXAttribute(a) && name(a.name) === 'className'
  )
  if (attrs.length !== 1 || !t.isJSXAttribute(attrs[0])) return
  const value = attributeValue(attrs[0])
  if (
    !t.isCallExpression(value) ||
    value.arguments.length !== 2 ||
    !t.isCallExpression(value.arguments[0]) ||
    value.arguments[0].arguments.length !== 1
  )
    return
  const merger = ref(value.callee, p)
  if (!merger.includes('#cn') && !merger.endsWith('.cn')) return
  const consumer = value.arguments[1]
  if (!t.isIdentifier(consumer) || parameters.get(ref(consumer, p))?.key !== 'className') return
  return {
    recipe: ref(value.arguments[0].callee, p),
    merger,
    options: expression(value.arguments[0].arguments[0], p, ref),
    parameters,
  }
}

/** Geometry is exact; root presentation is retained as separate evidence, never discarded in edits. */
function artworkOf(p: NodePath<t.JSXElement>, file: string, owner: string): Artwork | undefined {
  if (!t.isJSXIdentifier(p.node.openingElement.name, { name: 'svg' })) return
  const central =
    file.startsWith('packages/emcn/src/icons/') ||
    file.startsWith('packages/emcn/src/illustrations/')
  const root: Record<string, string> = {}
  let unknownRoot = false
  for (const a of p.node.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(a)) {
      if (!central) unknownRoot = true
      continue
    }
    const key = name(a.name)
    if (
      ['className', 'style', 'width', 'height', 'xmlns', 'role', 'focusable', 'tabIndex'].includes(
        key
      ) ||
      key.startsWith('aria-') ||
      key.startsWith('data-') ||
      /^on[A-Z]/.test(key)
    )
      continue
    const value = attributeValue(a)
    if (t.isStringLiteral(value) || t.isNumericLiteral(value)) root[key] = String(value.value)
    else unknownRoot = true
  }
  const drawing = (n: t.Node): unknown => {
    if (t.isJSXText(n)) return n.value.trim() ? undefined : null
    if (t.isJSXExpressionContainer(n) && t.isJSXEmptyExpression(n.expression)) return null
    if (!t.isJSXElement(n) || !t.isJSXIdentifier(n.openingElement.name)) return undefined
    if (
      !['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g'].includes(
        n.openingElement.name.name
      )
    )
      return undefined
    const attrs: Record<string, string> = {}
    for (const a of n.openingElement.attributes) {
      if (!t.isJSXAttribute(a)) return undefined
      const value = attributeValue(a)
      if (!t.isStringLiteral(value) && !t.isNumericLiteral(value)) return undefined
      attrs[name(a.name)] = String(value.value)
    }
    const children = n.children.map(drawing)
    if (children.includes(undefined)) return undefined
    return [
      n.openingElement.name.name,
      Object.entries(attrs).sort(([a], [b]) => compare(a, b)),
      children.filter((x) => x !== null),
    ]
  }
  const children = p.node.children.map(drawing)
  if (
    unknownRoot ||
    !root.viewBox ||
    children.includes(undefined) ||
    !children.some((x) => x !== null)
  )
    return
  return {
    file,
    owner,
    central,
    line: p.node.loc?.start.line ?? 1,
    column: (p.node.loc?.start.column ?? 0) + 1,
    fingerprint: hash(
      canonical([
        Object.entries(root).sort(([a], [b]) => compare(a, b)),
        children.filter((x) => x !== null),
      ])
    ),
    root: canonical(root),
  }
}

function choices(e: Expr, statics: StaticInputs): (Scalar | undefined)[] | undefined {
  const result = statics.evaluate(e)
  return result.unknown ? undefined : [...result.values, ...(result.undefined ? [undefined] : [])]
}
function object(e: Expr, statics: StaticInputs, depth = 0): Expr | undefined {
  if (depth > 20) return
  if (e.kind === 'ref') {
    const refs = statics.values.has(e.ref) ? [e.ref] : statics.resolve(e.ref)
    return refs.length === 1 && !statics.unsafe.has(e.ref)
      ? object(statics.values.get(refs[0]) ?? unknown, statics, depth + 1)
      : undefined
  }
  return e
}
function keys(e: Expr, statics: StaticInputs): string[] | undefined {
  const resolved = object(e, statics)
  if (resolved?.kind !== 'object' || resolved.entries.some((a) => 'spread' in a)) return
  return resolved.entries.flatMap((a) => ('key' in a ? [a.key] : []))
}
function strings(e: Expr, statics: StaticInputs): string[] | undefined {
  const result = choices(e, statics)
  return result?.every((x) => typeof x === 'string' || x == null || x === false)
    ? result.map((x) => (typeof x === 'string' ? x : ''))
    : undefined
}
function product<T>(sets: T[][]): T[][] | undefined {
  let rows: T[][] = [[]]
  for (const set of sets) {
    if (rows.length * set.length > 64 || !set.length) return
    rows = rows.flatMap((row) => set.map((v) => [...row, v]))
  }
  return rows
}

/** Interpret bounded CVA declarations; no cva, component or config module is imported. */
function recipeClasses(
  recipe: { base: Expr; config: Expr },
  pipeline: NonNullable<Detail['pipeline']>,
  props: Expr,
  graph: Graph
): string[] | undefined {
  const statics = graph.staticInputs
  const variants = statics.property(recipe.config, 'variants')
  const names = keys(variants, statics)
  const base = strings(recipe.base, statics)
  if (!names || !base) return
  const defaults = statics.property(recipe.config, 'defaultVariants')
  const values = names.map((key) => {
    const option = statics.property(pipeline.options, key)
    const param = option.kind === 'ref' ? pipeline.parameters.get(option.ref) : undefined
    let selected = choices(param ? statics.property(props, param.key) : option, statics)
    if (param && selected?.includes(undefined)) {
      const fallback = choices(param.fallback, statics)
      if (!fallback) return
      selected = selected.flatMap((v) => (v === undefined ? fallback : [v]))
    }
    const fallback = choices(statics.property(defaults, key), statics)
    if (!selected || !fallback) return
    return selected.flatMap((v) => (v === undefined ? fallback : [v]))
  })
  if (values.some((v) => !v)) return
  const combinations = product(values as (Scalar | undefined)[][])
  if (!combinations) return
  const compoundValue = object(statics.property(recipe.config, 'compoundVariants'), statics)
  const compounds =
    compoundValue?.kind === 'array'
      ? compoundValue.items
      : compoundValue?.kind === 'absent' || compoundValue?.kind === 'undefined'
        ? []
        : undefined
  if (!compounds) return
  const out: string[] = []
  for (const combination of combinations) {
    const selected = Object.fromEntries(names.map((key, i) => [key, combination[i]]))
    const parts: string[][] = [base]
    for (const key of names) {
      const v = selected[key]
      if (v == null) continue
      const classes = strings(statics.property(statics.property(variants, key), String(v)), statics)
      if (!classes) return
      parts.push(classes)
    }
    for (const compound of compounds) {
      const compoundKeys = keys(compound, statics)
      if (!compoundKeys) return
      let matches = true
      for (const key of compoundKeys.filter((k) => !['class', 'className'].includes(k))) {
        const expected = object(statics.property(compound, key), statics)
        const arrayValues =
          expected?.kind === 'array'
            ? expected.items.map((item) => choices(item, statics))
            : undefined
        if (arrayValues?.some((value) => !value)) return
        const alternatives = arrayValues
          ? (arrayValues as (Scalar | undefined)[][]).flat()
          : choices(expected ?? unknown, statics)
        if (!alternatives) return
        matches &&= alternatives.includes(selected[key])
      }
      if (matches)
        for (const key of ['class', 'className']) {
          const classes = strings(statics.property(compound, key), statics)
          if (!classes) return
          parts.push(classes)
        }
    }
    const combined = product(parts)
    if (!combined || out.length + combined.length > 64) return
    out.push(...combined.map((row) => row.filter(Boolean).join(' ')))
  }
  return [...new Set(out)]
}

/** A reusable analysis pass for immutable PR snapshots and complete working-tree audits. */
export function inspectSimplifications(
  source: ControlSource,
  styling: InventoryFinding[] = [],
  order: 'forward' | 'reverse' = 'forward',
  sourceIndex?: SourceIndex,
  centralReference?: Parameters<typeof inspectControls>[4],
  ownershipReview?: TypographyReview,
  metadata?: GeneratedContracts
): {
  controls: ControlInventory
  simplifications: SimplificationReport
  colourAssignments: ColourAssignmentReport
  shadowExtras: ShadowExtrasReport
  typographyReview: TypographyReview
  review: ReviewReport
} {
  const colourAssignments = new ColourAssignments(source)
  const review = new ReviewCollector(source, metadata ?? sourceIndex?.metadata)
  const details = new Map<string, Detail>()
  const recipes = new Map<string, { base: Expr; config: Expr }>()
  const artworks: Artwork[] = []
  let graph: Graph | undefined
  const notes: Diagnostic[] = []
  const controls = inspectControls(source, styling, order, sourceIndex, centralReference, {
    program(input) {
      colourAssignments.program(input)
      review.program(input)
    },
    jsx({ id, file, owner, path, reference }) {
      const content = contentOf(path, reference, owner)
      if (content.kind !== 'element') return
      details.set(id, { id, file, owner, content, pipeline: pipelineOf(path, reference) })
      const artwork = artworkOf(path, file, owner)
      if (artwork) artworks.push(artwork)
      else if (t.isJSXIdentifier(path.node.openingElement.name, { name: 'svg' }))
        notes.push({
          file,
          line: path.node.loc?.start.line ?? 1,
          context: owner,
          reason:
            'SVG equivalence unresolved: dynamic, referenced, styled or unsupported drawing structure',
        })
    },
    recipe(ref, base, config) {
      recipes.set(ref, { base, config })
    },
    complete(value) {
      graph = value
      review.complete(value)
    },
  })
  if (!graph) throw new Error('Control source graph unavailable')
  notes.push(...controls.unchecked)
  const g: Graph = graph
  const statics = g.staticInputs
  const findings: Simplification[] = []
  const coverage = {
    controls: controls.records.length,
    styleChecks: 0,
    nameChecks: 0,
    artwork: artworks.length,
  }
  const note = (use: Pick<RawUse, 'file' | 'line' | 'owner'>, reason: string) =>
    notes.push({ file: use.file, line: use.line, context: use.owner, reason })
  const add = (
    use: Pick<RawUse, 'file' | 'line' | 'column' | 'owner'>,
    rule: Simplification['rule'],
    value: string,
    reason: string,
    proof: Record<string, unknown>
  ) => {
    const property =
      rule === 'control-redundant-style'
        ? 'className'
        : rule === 'control-accessible-name'
          ? 'accessible-name'
          : 'artwork'
    const id = hash(canonical([rule, use.file, use.line, use.column, use.owner, value]))
    findings.push({
      id,
      kind: 'usage-violation',
      contract: rule,
      rule,
      category: 'control-simplification',
      property,
      value,
      reason,
      file: use.file,
      line: use.line,
      column: use.column,
      context: use.owner,
      observedFrom: [use.file],
      proof,
      relatedFindingIds: styling
        .filter((f) => f.file === use.file && f.line === use.line)
        .map((f) => f.id)
        .sort(compare),
      provenance: {
        source:
          rule === 'control-redundant-style'
            ? String(proof.recipe)
            : 'scripts/design-conformance/README.md#control-simplifications',
        input: value,
        permitted: reason,
      },
    })
  }
  let mergeVerified = false
  const mergeEntry = source.entries.find((e) => e.path === MERGE_SOURCE)
  if (mergeEntry) {
    try {
      mergeVerified =
        hash(
          artworkSyntax(
            parse(source.read(mergeEntry), { sourceType: 'module', plugins: ['typescript'] })
              .program
          )
        ) === MERGE_AST
    } catch {
      /* Recorded below; never import the module as a fallback. */
    }
  }
  const direct = (use: RawUse) => g.resolve(use.target)
  const sameOwner = (target: string, detail: Pick<Detail, 'file' | 'owner'>) =>
    target.startsWith(`${detail.file}#${detail.owner}@`)
  const rendererDetails = (use: RawUse) =>
    [...details.values()].filter((d) => direct(use).some((ref) => sameOwner(ref, d)))
  for (const use of controls.records) {
    if (use.file.startsWith('packages/emcn/') || use.syntax !== 'jsx') continue
    if (!use.terminals.length) continue
    const consumer = use.inputs.className
    if (!consumer) continue
    const renderers = rendererDetails(use).filter((d) => d.pipeline)
    if (!direct(use).every((ref) => ref.startsWith('packages/emcn/')) || renderers.length !== 1) {
      if (use.origin === 'emcn-component')
        note(
          use,
          'Redundant-style proof unavailable: renderer class pipeline is not a single supported direct CVA composition'
        )
      continue
    }
    const pipeline = renderers[0].pipeline
    const props = g.props.get(use.id)
    if (
      !pipeline ||
      !props ||
      !mergeVerified ||
      !g.resolve(pipeline.merger).length ||
      !g.resolve(pipeline.merger).every((r) => r.startsWith(`${MERGE_SOURCE}#cn@`)) ||
      consumer.unresolved ||
      !consumer.values?.every((v) => typeof v === 'string')
    ) {
      note(
        use,
        'Redundant-style proof unavailable: unresolved consumer inputs or merge configuration'
      )
      continue
    }
    const refs = g.resolve(pipeline.recipe)
    const recipe = refs.length === 1 ? recipes.get(refs[0]) : undefined
    const central = recipe && recipeClasses(recipe, pipeline, props, g)
    if (!central?.length) {
      note(
        use,
        'Redundant-style proof unavailable: active recipe/default/conditional alternatives unresolved'
      )
      continue
    }
    coverage.styleChecks++
    const consumers = consumer.values as string[]
    const candidates = [...new Set(consumers.flatMap(tokens))].sort(compare)
    for (const candidate of candidates) {
      const relevant = consumers.filter((classes) => tokens(classes).includes(candidate))
      if (!central.every((classes) => tokens(classes).includes(candidate))) continue
      const proof = central.every((base) =>
        relevant.every(
          (classes) =>
            tokenSet(mergeClasses(base, classes)) ===
            tokenSet(
              mergeClasses(
                base,
                tokens(classes)
                  .filter((c) => c !== candidate)
                  .join(' ')
              )
            )
        )
      )
      if (proof)
        add(
          use,
          'control-redundant-style',
          candidate,
          'Remove the repeated consumer token; the active EMCN recipe supplies identical final classes in every resolved alternative',
          {
            recipe: refs[0],
            mergeSource: MERGE_SOURCE,
            mergeAst: MERGE_AST,
            alternatives: central.length * consumers.length,
            centralClasses: central,
            consumerClasses: consumers,
          }
        )
    }
  }

  type NameState = 'named' | 'empty' | 'unknown'
  const texts = (e: Expr): NameState => {
    const values = choices(e, statics)
    if (!values) return 'unknown'
    const nonempty = values.map((v) => (typeof v === 'string' ? !!v.trim() : typeof v === 'number'))
    return nonempty.length && nonempty.every(Boolean)
      ? 'named'
      : nonempty.some(Boolean)
        ? 'unknown'
        : 'empty'
  }
  const allAlternatives = (states: NameState[]): NameState =>
    states.every((s) => s === 'named')
      ? 'named'
      : states.every((s) => s === 'empty')
        ? 'empty'
        : 'unknown'
  const siblings = (states: NameState[]): NameState =>
    states.includes('named') ? 'named' : states.includes('unknown') ? 'unknown' : 'empty'
  const contentName = (
    content: Content,
    detail: Pick<Detail, 'file' | 'owner'>,
    seen = new Set<string>(),
    depth = 0,
    incoming?: Expr,
    referencedHidden = false
  ): NameState => {
    if (depth > 20) return 'unknown'
    if (content.kind === 'unknown') return 'unknown'
    if (content.kind === 'text') return texts(content.value)
    if (content.kind === 'choice')
      return allAlternatives(
        content.children.map((c) =>
          contentName(c, detail, seen, depth + 1, undefined, referencedHidden)
        )
      )
    let props = content.props
    if (incoming && content.forwarded && props.kind === 'object') {
      const keysToOmit = content.forwarded.omitted
      const rest: Expr = {
        kind: 'object',
        entries: [
          { spread: incoming },
          ...keysToOmit.map((key) => ({ key, value: { kind: 'undefined' } as Expr })),
        ],
      }
      props = {
        kind: 'object',
        entries: props.entries.map((entry) =>
          'spread' in entry &&
          entry.spread.kind === 'ref' &&
          entry.spread.ref === content.forwarded?.ref
            ? { spread: rest }
            : entry
        ),
      }
    }
    const hidden = choices(statics.property(props, 'aria-hidden'), statics)
    if (!referencedHidden && hidden?.length && hidden.every((v) => v === true || v === 'true'))
      return 'empty'
    if (!referencedHidden && (!hidden || hidden.some((v) => v === true || v === 'true')))
      return 'unknown'
    const label = texts(statics.property(props, 'aria-label'))
    const title = texts(statics.property(props, 'title'))
    if (label !== 'empty' || title !== 'empty') {
      const explicit = choices(statics.property(props, 'role'), statics)
      if (!explicit) return 'unknown'
      const roleNames = explicit
        .filter((v): v is string => typeof v === 'string' && !!v.trim())
        .map((v) => v.split(/\s+/).find((r) => roles.has(r as ARIARoleDefinitionKey)))
      if (!roleNames.length && content.target.startsWith('native:')) {
        const tag = content.target.slice('native:'.length)
        if (tag === 'svg') roleNames.push('graphics-document')
        else {
          const candidates: { specificity: number; names: string[] }[] = []
          for (const [schema, names] of elementRoles.entries()) {
            if (schema.name !== tag) continue
            if (schema.constraints?.length) continue
            let matches = true
            for (const attr of schema.attributes ?? []) {
              const values = choices(statics.property(props, attr.name), statics)
              if (!values) return 'unknown'
              const constraints: readonly string[] = attr.constraints ?? []
              if (constraints.some((c) => c !== 'set' && c !== 'undefined' && c !== 'unset'))
                return 'unknown'
              if (
                !values.every((v) =>
                  attr.value !== undefined
                    ? String(v) === attr.value
                    : constraints.includes('set')
                      ? v !== undefined && v !== null
                      : v === undefined
                )
              )
                matches = false
            }
            if (matches)
              candidates.push({ specificity: schema.attributes?.length ?? 0, names: [...names] })
          }
          const mostSpecific = Math.max(...candidates.map((c) => c.specificity))
          roleNames.push(
            ...candidates.filter((c) => c.specificity === mostSpecific).flatMap((c) => c.names)
          )
        }
      }
      if (roleNames.length) {
        const permits = roleNames.map((r) => {
          const role = r ? roles.get(r as ARIARoleDefinitionKey) : undefined
          return role && 'nameFrom' in role && Array.isArray(role.nameFrom)
            ? role.nameFrom.includes('author')
            : undefined
        })
        if (
          permits.some((v) => v === undefined) ||
          (permits.includes(true) && permits.includes(false))
        )
          return 'unknown'
        if (permits.every(Boolean)) return label !== 'empty' ? label : title
      } else if (!content.target.startsWith('native:')) return label !== 'empty' ? label : title
    }
    if (content.target.startsWith('native:')) {
      if (['native:img', 'native:input'].includes(content.target))
        return texts(statics.property(content.props, 'alt'))
      return siblings(
        content.children.map((c) =>
          contentName(c, detail, seen, depth + 1, undefined, referencedHidden)
        )
      )
    }
    let refs = g.resolve(content.target)
    if (content.parameter) {
      const callers = g.uses.filter((u) => direct(u).some((target) => sameOwner(target, detail)))
      if (!callers.length) return 'unknown'
      refs = callers.flatMap((u) => {
        const e = statics.property(g.props.get(u.id) ?? unknown, content.parameter?.key ?? '')
        return e.kind === 'ref' ? g.resolve(e.ref) : ['unknown:parameter']
      })
    }
    const states = refs.map((target): NameState => {
      if (seen.has(target)) return 'unknown'
      const roots = [...details.values()].filter(
        (d) => sameOwner(target, d) && d.content.target === 'native:svg'
      )
      if (roots.length !== 1) return 'unknown'
      return contentName(
        roots[0].content,
        roots[0],
        new Set([...seen, target]),
        depth + 1,
        content.props,
        referencedHidden
      )
    })
    return states.length ? allAlternatives(states) : 'unknown'
  }
  for (const use of controls.records) {
    if (use.file.startsWith('packages/emcn/') || use.syntax !== 'jsx' || use.hidden) continue
    const isButton =
      use.target === 'native:button' ||
      (use.target.startsWith('native:') &&
        !use.inputs.role?.unresolved &&
        !!use.inputs.role?.values?.length &&
        use.inputs.role.values.every((value) => value === 'button')) ||
      (direct(use).length > 0 &&
        direct(use).every((ref) =>
          /^packages\/emcn\/src\/components\/(button|chip)\/[^#]+#(?:Button|Chip)@/.test(ref)
        ))
    if (!isButton) continue
    const detail = details.get(use.id)
    if (!detail) continue
    if (
      !!use.inputs.className?.values?.length &&
      !use.inputs.className.mayBeUndefined &&
      use.inputs.className.values.every((value) => value === 'hidden') &&
      !use.inputs.className.unresolved
    )
      continue
    coverage.nameChecks++
    const props = detail.content.props
    const label = texts(statics.property(props, 'aria-label'))
    const labelledBy = choices(statics.property(props, 'aria-labelledby'), statics)
    let state: NameState = label
    if (!labelledBy) state = 'unknown'
    else if (labelledBy.some((v) => typeof v === 'string' && v.trim())) {
      state = allAlternatives(
        labelledBy.map((value): NameState => {
          if (typeof value !== 'string' || !value.trim()) return 'unknown'
          return siblings(
            tokens(value).map((id): NameState => {
              const matches = [...details.values()].filter(
                (d) =>
                  d.file === use.file &&
                  d.owner === use.owner &&
                  choices(statics.property(d.content.props, 'id'), statics)?.includes(id)
              )
              return matches.length === 1
                ? contentName(matches[0].content, matches[0], new Set(), 0, undefined, true)
                : 'unknown'
            })
          )
        })
      )
    }
    if (state === 'empty')
      state = siblings(detail.content.children.map((c) => contentName(c, detail)))
    if (state === 'empty') state = texts(statics.property(props, 'title'))
    if (state === 'unknown')
      note(use, 'Accessible name unresolved: dynamic naming, spread, content, or label reference')
    else if (state === 'empty')
      add(
        use,
        'control-accessible-name',
        'missing',
        'Provide the existing action name on the button; a tooltip description is not an accessible name',
        {
          target: direct(use),
          children: 'statically empty or decorative',
          namingChannels: 'no nonempty aria-label, labelledby, text or title',
        }
      )
  }
  const groups = new Map<string, Artwork[]>()
  for (const artwork of artworks) {
    const group = groups.get(artwork.fingerprint) ?? []
    group.push(artwork)
    groups.set(artwork.fingerprint, group)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const central = group.filter((x) => x.central)
    for (const artwork of group.filter((x) => !x.central))
      add(
        artwork,
        'control-duplicate-artwork',
        artwork.fingerprint,
        central.length
          ? 'Reuse the identical central artwork, preserving caller size and paint'
          : 'Consolidate the identical static drawing into one central artwork implementation',
        {
          geometryFingerprint: artwork.fingerprint,
          rootAttributes: artwork.root,
          central: central.map((a) => `${a.file}#${a.owner}`).sort(compare),
          occurrences: group.map((a) => `${a.file}:${a.line}`).sort(compare),
        }
      )
  }
  const colourReport = colourAssignments.finish(statics)
  const typography = ownershipReview ?? inspectTypography(source)
  const shadows = inspectShadowExtras(
    source,
    (name) => colourAssignments.globalColour(name),
    colourReport
  )
  const stylingReview = review.finish(controls)
  for (const item of shadows.approved)
    stylingReview.findings.push({
      id: hash(canonical(['local-shadow', item])),
      observedFrom: [item.file],
      rule: 'local-shadow',
      contract: 'local-shadow',
      kind: 'usage-violation',
      category: 'effects',
      property: 'box-shadow',
      value: item.id,
      reason: item.reason,
      file: item.file,
      line: item.line,
      column: 1,
      context: item.selector,
    })
  for (const item of typography.classifications)
    if (item.disposition === 'extra')
      stylingReview.findings.push({
        id: hash(canonical(['specialised-typography', item])),
        observedFrom: [item.file],
        rule: 'specialised-typography',
        contract: 'specialised-typography',
        kind: 'usage-violation',
        category: 'typography',
        property: item.property,
        value: item.value,
        reason: item.reason,
        file: item.file,
        line: item.line,
        column: 1,
        context: item.property,
      })
  return {
    controls,
    colourAssignments: colourReport,
    review: stylingReview,
    typographyReview: typography,
    shadowExtras: shadows,
    simplifications: {
      version: '1.0.0',
      findings: findings.sort(
        (a, b) =>
          compare(a.file, b.file) ||
          a.line - b.line ||
          a.column - b.column ||
          compare(a.rule, b.rule) ||
          compare(a.value, b.value)
      ),
      unchecked: [...new Map(notes.map((n) => [canonical(n), n])).values()].sort((a, b) =>
        compare(canonical(a), canonical(b))
      ),
      coverage,
    },
  }
}
