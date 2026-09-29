import { compareStrings } from '@sim/utils/string'
import {
  type Catalogue,
  canonical,
  type Facts,
  type Finding,
  hash,
  inspectionFailure,
  type Surface,
  TOKEN_FILE,
} from '#design-conformance/shared/model'
import {
  type Compiler,
  competingProperties,
  declarations,
  normalizeValue,
  utility,
} from '#design-conformance/shared/normalize'

interface Value {
  property: string
  context: string
  category: string
  values: string[]
}
interface View {
  source: Surface
  values: Map<string, Value>
  signature: string
}
const layoutOnly =
  /^(?:(?:min-|max-)?width|flex|flex-(?:grow|shrink|basis)|align-self|justify-self|grid-(?:column|row)(?:-|$)|margin(?:-|$))$/
const controls =
  /(?:^|#)(?:button|input|select|textarea|Button|Chip(?:Link|Input|Textarea|Dropdown|Select|Switch)?|DropdownMenuItem|Select|Combobox)$/
const shown = (values?: string[]) => {
  const text = canonical(values ?? [])
  return text.length <= 4096
    ? text
    : `${text.slice(0, 4000)}… [full sha256:${hash(text)}; ${text.length} characters]`
}

/** Compare supported presentation inputs. No palette membership or runtime appearance claims. */
export function appearanceDiff(
  before: Facts,
  after: Facts,
  file: string,
  system: Compiler,
  catalogue: Catalogue
): { findings: Finding[]; unchecked: Facts['unchecked'] } {
  const findings: Finding[] = []
  const unchecked: Facts['unchecked'] = []
  if ([...before.unchecked, ...after.unchecked].some(inspectionFailure))
    return { findings, unchecked }
  const cssOrder = (facts: Facts) =>
    (facts.surfaces ?? [])
      .filter((surface) => surface.owner === 'css')
      .map((surface) =>
        canonical([surface.target, surface.atoms.map((atom) => [atom.property, atom.value])])
      )
  const oldCssOrder = cssOrder(before)
  const newCssOrder = cssOrder(after)
  if (
    canonical(oldCssOrder) !== canonical(newCssOrder) &&
    canonical([...oldCssOrder].sort()) === canonical([...newCssOrder].sort())
  )
    unchecked.push({
      line: 1,
      context: 'css-rule-order',
      reason: 'CSS rule order changed; cross-selector cascade precedence is unchecked',
    })
  const surfaces = (facts: Facts): Surface[] => {
    const result: Surface[] = []
    const rules = new Map<string, Surface>()
    for (const source of facts.surfaces ?? []) {
      if (source.owner !== 'css' || source.atoms.every((atom) => atom.property.startsWith('@'))) {
        result.push(source)
        continue
      }
      const key = canonical([source.kind, source.target])
      const existing = rules.get(key)
      if (existing) existing.atoms.push(...source.atoms)
      else {
        const merged = { ...source, atoms: [...source.atoms] }
        rules.set(key, merged)
        result.push(merged)
      }
    }
    return result
  }
  const views = (facts: Facts): View[] =>
    surfaces(facts).map((source) => {
      const values = new Map<string, Value>()
      const cascade = new Map<string, { property: string; value: string }[]>()
      for (const atom of source.atoms) {
        if (file === TOKEN_FILE && atom.kind === 'token') continue
        const prop = atom.property
        const special = /^(?:prop:|default:|@)/.test(prop) || atom.kind === 'token'
        const ds = special
          ? [
              {
                property: prop,
                value:
                  normalizeValue(atom.value) +
                  (/\s!important\s*$/.test(atom.value) ? ' !important' : ''),
                category: prop.startsWith('default:')
                  ? 'variants'
                  : prop.startsWith('prop:')
                    ? 'component-appearance'
                    : prop.startsWith('@')
                      ? 'styling-infrastructure'
                      : 'custom-properties',
              },
            ]
          : declarations(atom, system, catalogue.variables, true)
        if (ds === null) {
          unchecked.push({
            line: atom.line,
            context: atom.context,
            reason: `Unsupported styling utility: ${atom.value}`,
          })
          continue
        }
        for (const d of ds) {
          const context = `${atom.context}${atom.kind === 'class' ? utility(atom.value).variants : ''}`
          const key = canonical([context, d.property])
          const entry = values.get(key) ?? {
            property: d.property,
            context,
            category: d.category,
            values: [],
          }
          if (entry.values.at(-1) !== d.value) entry.values.push(d.value)
          values.set(key, entry)
          if (atom.kind !== 'token' && !d.property.startsWith('@')) {
            const sequence = cascade.get(context) ?? []
            sequence.push({ property: d.property, value: d.value })
            cascade.set(context, sequence)
          }
        }
      }
      for (const [context, sequence] of cascade) {
        const competing: string[] = []
        for (const important of [false, true]) {
          const declarations = sequence.filter(
            (entry) => / !important$/.test(entry.value) === important
          )
          const properties = [...new Set(declarations.map((entry) => entry.property))]
          if (properties.length > 256) {
            unchecked.push({
              line: source.line,
              context,
              reason:
                'CSS cascade order exceeds the 256-property comparison limit; shorthand precedence is unchecked',
            })
            continue
          }
          const overlapping = new Set<string>()
          for (let i = 0; i < properties.length; i++)
            for (let j = i + 1; j < properties.length; j++)
              if (competingProperties(properties[i], properties[j])) {
                overlapping.add(properties[i])
                overlapping.add(properties[j])
              }
          if (overlapping.size)
            competing.push(
              canonical(declarations.filter((entry) => overlapping.has(entry.property)))
            )
        }
        if (competing.length)
          values.set(canonical([context, 'declaration-order']), {
            property: 'declaration-order',
            context,
            category: 'cascade',
            values: competing,
          })
      }
      // Independent declaration order is irrelevant; competing values retain composition order.
      const signature = canonical([
        source.kind,
        source.target,
        [...new Set(source.references)].sort(),
        [...values].sort(([a], [b]) => compareStrings(a, b)),
      ])
      return { source, values, signature }
    })
  const old = views(before)
  const next = views(after)
  const oldSignatures = new Set(old.map((x) => x.signature))
  const removed = [...old]
  for (const current of next) {
    const index = removed.findIndex((previous) => previous.signature === current.signature)
    if (index >= 0) removed.splice(index, 1)
  }
  const emit = (
    rule: string,
    value: Value,
    b: string[] | undefined,
    a: string[] | undefined,
    source: Surface,
    reason: string
  ) =>
    findings.push({
      rule,
      category: value.category,
      property: value.property,
      value: shown(a),
      before: b ? shown(b) : null,
      reason,
      file,
      line: source.line,
      column: source.column,
      context: `${source.owner} / ${source.target} / ${value.context}`,
    })
  const compare = (b: View | undefined, a: View | undefined) => {
    const s = (a ?? b)?.source
    if (!s) return
    // Integration metadata is an established labelled-tag contract, only for existing entries.
    if (s.kind === 'integration' && (!b || !a)) return
    if (
      b &&
      a &&
      b.source.shared &&
      b.source.target !== a.source.target &&
      controls.test(b.source.target) &&
      controls.test(a.source.target)
    )
      emit(
        'component-replaced',
        { property: 'component', category: 'component-appearance', context: '', values: [] },
        [b.source.target],
        [a.source.target],
        s,
        'An existing shared control was replaced by a different control'
      )
    const detached =
      b &&
      a &&
      b.source.references.some((r) => !a.source.references.includes(r)) &&
      a.source.references.every((r) => b.source.references.includes(r)) &&
      a.values.size > 0
    if (detached)
      emit(
        'shared-style-detached',
        { property: 'shared-style-reference', category: 'ownership', context: '', values: [] },
        b.source.references,
        a.source.references,
        s,
        'An imported styling reference was removed while local styling remains; future shared changes may no longer propagate'
      )
    for (const key of new Set([...(b?.values.keys() ?? []), ...(a?.values.keys() ?? [])])) {
      const previous = b?.values.get(key)
      const current = a?.values.get(key)
      if (canonical(previous?.values) === canonical(current?.values)) continue
      const v = (current ?? previous) as Value
      const relevant = (view: View | undefined) =>
        (view?.source.unresolved ?? [])
          .filter(
            (u) =>
              u.channel === 'spread' ||
              u.channel === 'class' ||
              u.property === '*' ||
              u.property === v.property
          )
          .map(({ line: _line, ...input }) => input)
      const unknownBefore = relevant(b)
      const unknownAfter = relevant(a)
      // A new/changed computed input might supply the missing declaration. Stable forwarded
      // inputs do not hide an explicit edit to another part of the same composition.
      if (!current && unknownAfter.length && canonical(unknownBefore) !== canonical(unknownAfter)) {
        unchecked.push({
          line: s.line,
          context: `${s.owner} / ${s.target} / ${v.context}`,
          reason: `Previous explicit ${v.property} input ${shown(previous?.values)} is absent, but the replacement composition has changed unresolved inputs; helper output is unknown, so no removal is inferred`,
        })
        continue
      }
      if (!b && s.shared && (layoutOnly.test(v.property) || v.property.startsWith('prop:')))
        continue
      let rule = b
        ? 'appearance-changed'
        : s.shared
          ? 'shared-component-override'
          : 'new-custom-style'
      if (v.property.startsWith('default:')) rule = 'variant-default-changed'
      if (v.property.startsWith('@')) rule = 'styling-infrastructure-changed'
      if (v.property === 'declaration-order') rule = 'style-precedence-changed'
      if (
        previous &&
        current &&
        canonical([...previous.values].sort()) === canonical([...current.values].sort())
      )
        rule = 'style-precedence-changed'
      emit(
        rule,
        v,
        previous?.values,
        current?.values,
        s,
        b
          ? `Explicit styling input changed from ${shown(previous?.values)} to ${shown(current?.values)}${unknownBefore.length || unknownAfter.length ? '; helper/forwarded output remains unchecked' : ''}`
          : s.shared
            ? 'A shared component receives local appearance customization'
            : 'New custom styling or layout was introduced'
      )
    }
  }
  for (const a of next) {
    // Repeated styled options/rows are content additions, not new design definitions.
    if (oldSignatures.has(a.signature)) continue
    let i = removed.findIndex(
      (b) =>
        b.source.kind === a.source.kind &&
        b.source.owner === a.source.owner &&
        b.source.target === a.source.target
    )
    // A local function/file rename must not hide edits to its unique presentation target.
    if (i < 0) {
      const candidates = removed
        .map((b, index) => ({ b, index }))
        .filter(({ b }) => b.source.kind === a.source.kind && b.source.target === a.source.target)
      if (
        candidates.length === 1 &&
        next.filter(
          (b) =>
            b.source.kind === a.source.kind &&
            b.source.target === a.source.target &&
            !oldSignatures.has(b.signature)
        ).length === 1
      )
        i = candidates[0].index
    }
    if (i < 0 && controls.test(a.source.target))
      i = removed.findIndex(
        (b) =>
          b.source.owner === a.source.owner && b.source.shared && controls.test(b.source.target)
      )
    const b = i >= 0 ? removed.splice(i, 1)[0] : undefined
    compare(b, a)
  }
  // Removed shared definitions matter; removing an entire UI element is functional/content scope.
  for (const b of removed)
    if (b.source.kind !== 'element' && b.source.kind !== 'integration') compare(b, undefined)
  return { findings: [...new Map(findings.map((x) => [canonical(x), x])).values()], unchecked }
}
