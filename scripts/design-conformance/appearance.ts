import {
  type Catalogue,
  canonical,
  type Facts,
  type Finding,
  hash,
  type Surface,
  TOKEN_FILE,
} from '#design-conformance/model'
import { type Compiler, declarations, normalizeValue, utility } from '#design-conformance/normalize'

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
  if (
    [...before.unchecked, ...after.unchecked].some((n) =>
      /^(?:Parser failure|Source exceeds)/.test(n.reason)
    )
  )
    return { findings, unchecked }
  const views = (facts: Facts): View[] =>
    (facts.surfaces ?? []).map((source) => {
      const values = new Map<string, Value>()
      for (const atom of source.atoms) {
        if (file === TOKEN_FILE && atom.kind === 'token') continue
        const prop = atom.property
        const special = /^(?:prop:|default:|@)/.test(prop) || atom.kind === 'token'
        const ds = special
          ? [
              {
                property: prop,
                value: normalizeValue(atom.value),
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
        }
      }
      // Independent declaration order is irrelevant; competing values retain composition order.
      const signature = canonical([
        source.kind,
        source.target,
        [...new Set(source.references)].sort(),
        [...values].sort(([a], [b]) => a.localeCompare(b)),
      ])
      return { source, values, signature }
    })
  const old = views(before)
  const next = views(after)
  const oldSignatures = new Set(old.map((x) => x.signature))
  const nextSignatures = new Set(next.map((x) => x.signature))
  const removed = old.filter((x) => !nextSignatures.has(x.signature))
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
