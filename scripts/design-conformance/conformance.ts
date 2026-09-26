import { compareStrings } from '@sim/utils/string'
import valueParser from 'postcss-value-parser'
import { productScope } from '#control-analysis/scope'
import { appearanceDiff } from '#design-conformance/appearance'
import { artworkDiff, artworkFile, localArtworkDiff } from '#design-conformance/artwork'
import {
  centralFile,
  centralInventory,
  componentContract,
  contractsHash,
  isRegistry,
  registry,
} from '#design-conformance/contracts'
import { type DesignSystem, designSystem } from '#design-conformance/design-system'
import { extract } from '#design-conformance/extract'
import {
  type Atom,
  type Change,
  type Commits,
  canonical,
  type Declaration,
  type Entry,
  type Facts,
  type Finding,
  family,
  hash,
  implementationHash,
  inspectionFailure,
  type Report,
  TOKEN_FILE,
  VERSION,
} from '#design-conformance/model'
import { declarations, rawColours, utility, variablesIn } from '#design-conformance/normalize'
import { recipeDiff } from '#design-conformance/recipe-diff'
import { SourceIndex } from '#design-conformance/source-summary'
import { configurationExplanation } from '#design-conformance/system-explanation'
import {
  assertRecipeSnapshot,
  type SystemInput,
  snapshotHash,
} from '#design-conformance/system-snapshot'

const neutral =
  /^(?:none|inherit|initial|unset|revert|revert-layer|normal|currentColor|transparent)$/
const shown = (value: string) =>
  value.length <= 4096 ? value : `${value.slice(0, 4000)}… [sha256:${hash(value)}]`
interface Checked {
  findings: Finding[]
  unchecked: Facts['unchecked']
  governed: number
  ungoverned: number
}

/** Reuse the maintained finding rules when auditing an entire source tree. */
export { inspect as inspectSnapshotFacts, prepared as prepareSnapshotFacts }
function inputSlot(atom: Atom): string {
  return atom.context.split('/')[0] || (atom.kind === 'style' ? 'style' : 'className')
}
/** Declarative historical utility aliases; no proposed plugin or build execution. */
function compilationAtom(atom: Atom, system: DesignSystem): Atom {
  if (atom.kind !== 'class' || !system.entries.some((e) => /tailwind\.config\./.test(e.path)))
    return atom
  const { base, variants } = utility(atom.value)
  const aliases: Record<string, string> = {
    'shadow-sm': 'shadow-xs',
    shadow: 'shadow-sm',
    'outline-none': 'outline-hidden',
    'blur-sm': 'blur-xs',
    blur: 'blur-sm',
    'drop-shadow-sm': 'drop-shadow-xs',
    'drop-shadow': 'drop-shadow-sm',
  }
  const mapped =
    aliases[base] ??
    (base.startsWith('bg-gradient-to-')
      ? base.replace('bg-gradient-to-', 'bg-linear-to-')
      : undefined)
  if (!mapped) return atom
  if (base.startsWith('shadow-') && system.catalogue.variables[`--shadow-${base.slice(7)}`])
    return atom
  return { ...atom, value: `${variants}${mapped}${/(?:^|:)!|!$/.test(atom.value) ? '!' : ''}` }
}
function comparisonInput(atom: Atom, system: DesignSystem, value: string): string {
  if (atom.kind !== 'class') return value
  const canonical = compilationAtom(atom, system)
  const parts = utility(canonical.value)
  return `${parts.variants}${parts.base}${/(?:^|:)!|!$/.test(canonical.value) ? '!' : ''}`.replace(
    /#[a-fA-F\d]+/g,
    (x) => x.toLowerCase()
  )
}
function named(atom: Atom, property: string): string | undefined {
  if (atom.kind !== 'class') return undefined
  const base = utility(atom.value).base
  const prefixes: Record<string, RegExp> = {
    colours:
      /^(?:text|bg|border(?:-[trblxyse])?|outline|ring(?:-offset)?|fill|stroke|decoration|from|via|to|accent|caret)-(.+?)(?:\/[\d.]+)?$/,
    'font-family': /^font-(.+)$/,
    'font-size': /^text-(.+)$/,
    'font-weight': /^font-(.+)$/,
    'border-radius': /^rounded(?:-[trblse]{1,2})?-(.+)$/,
    'box-shadow': /^(?:inset-)?shadow-(.+)$/,
  }
  const found = base.match(prefixes[property] ?? /$a/)?.[1]
  return found && !/[[(]/.test(found) ? found : undefined
}
function governed(property: string, category: string, system: DesignSystem): string | undefined {
  if (category === 'colours') return 'colours'
  if (['font-family', 'font-size', 'font-weight'].includes(property)) return property
  if (
    property === 'border-radius' &&
    [...system.variableFamilies.values()].some((v) => v.has('border-radius'))
  )
    return property
  if (
    /^(?:box|text)-shadow$/.test(property) &&
    [...system.variableFamilies.values()].some((v) => v.has('box-shadow'))
  )
    return 'box-shadow'
  return undefined
}
function expanded(ds: Declaration[], system: DesignSystem): Declaration[] {
  return ds.flatMap((d) => {
    if (/^(?:border(?:-(?:top|bottom|left|right))?|outline)$/.test(d.property))
      return (
        declarations(
          { kind: 'style', property: d.property, value: d.value, line: 1, column: 1, context: '' },
          system.compiler,
          {}
        ) ?? [d]
      )
    if (d.property !== 'font' || neutral.test(d.value)) return [d]
    const parts = valueParser(d.value).nodes.filter(
      (n) => n.type !== 'space' && n.type !== 'comment'
    )
    const values = parts.map((n) => valueParser.stringify(n))
    const size = values.findIndex((v) => /^(?:[\d.]+(?:px|rem|em|%|pt)|var\(--text-)/.test(v))
    if (size < 0) return [{ ...d, property: 'font-family' }]
    const familyStart = values[size + 1] === '/' ? size + 3 : size + 1
    return [
      ...values
        .slice(0, size)
        .filter((v) => /^(?:\d+|bold|bolder|lighter)$/.test(v))
        .map((v) => ({ ...d, property: 'font-weight', value: v })),
      { ...d, property: 'font-size', value: values[size] },
      { ...d, property: 'font-family', value: values.slice(familyStart).join(' ') },
    ]
  })
}
function inspect(facts: Facts, file: string, system: DesignSystem): Checked {
  const out: Checked = { findings: [], unchecked: [...facts.unchecked], governed: 0, ungoverned: 0 }
  const localVars = new Map(
    (facts.surfaces ?? []).flatMap((s) =>
      s.atoms
        .filter((a) => a.kind === 'token' || a.property.startsWith('--'))
        .map((a) => [a.property, a.value] as const)
    )
  )
  const expand = (value: string, seen = new Set<string>()): string =>
    value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (all, key: string) => {
      if (
        system.variableFamilies.has(key) ||
        !localVars.has(key) ||
        seen.has(key) ||
        seen.size >= 12
      )
        return all
      return expand(localVars.get(key) as string, new Set(seen).add(key))
    })
  for (const surface of facts.surfaces ?? []) {
    if (surface.kind === 'integration') continue
    const surfaceFindings = new Set<string>()
    const emit = (
      rule: string,
      category: string,
      property: string,
      value: string,
      atom: Atom | undefined,
      reason?: string
    ) => {
      const contract = registry.rules[rule]
      const context = `${surface.owner} / ${surface.target} / ${atom ? inputSlot(atom) : ''}${atom?.kind === 'class' ? utility(atom.value).variants : ''}`
      const occurrence = canonical([rule, property, value, context])
      if (surfaceFindings.has(occurrence)) return
      surfaceFindings.add(occurrence)
      out.findings.push({
        kind: 'usage-violation',
        contract: rule,
        rule,
        category,
        property,
        value: shown(displayInput(atom, value)),
        file,
        line: atom?.line ?? surface.line,
        column: atom?.column ?? surface.column,
        context,
        reason: `${reason ?? contract.permission}${atom?.partial ? '; explicit recipe structure is known; its dynamic colour parameter remains unresolved' : ''}`,
        provenance: {
          source: contract.source,
          input: shown(displayInput(atom, atom?.value ?? value)),
          permitted: contract.permission,
          ...(atom ? { composition: atom.context } : {}),
        },
      })
    }
    if (surface.structuralViolation)
      emit(
        'modal-field',
        'structure',
        'field-wrapper',
        'ChipModalField',
        undefined,
        surface.structuralViolation
      )
    const contract = componentContract(surface.target, system.metadata)
    for (const atom of surface.atoms) {
      if (
        atom.kind === 'token' ||
        atom.property.startsWith('--') ||
        /^(?:prop:|default:|@)/.test(atom.property)
      )
        continue
      const ds = declarations(compilationAtom(atom, system), system.compiler, {}, true)
      if (ds === null) {
        out.unchecked.push({
          line: atom.line,
          context: atom.context,
          reason: `Unsupported styling utility: ${atom.value}`,
        })
        continue
      }
      const emitted = new Set<string>()
      for (const d of expanded(ds, system)) {
        const property = family(d.property)
        const slot = inputSlot(atom)
        if (
          contract &&
          !contract.slots?.includes(slot) &&
          !out.unchecked.some(
            (n) => n.context === atom.context && n.reason === `Unknown styling slot: ${slot}`
          )
        )
          out.unchecked.push({
            line: atom.line,
            context: atom.context,
            reason: `Unknown styling slot: ${slot}`,
          })
        const variants = atom.kind === 'class' ? utility(atom.value).variants : ''
        const ownsTarget = !/(?:^|:)(?:before|after|\*|\*\*):|\[&[_>+~ ]|&::(?:before|after)/.test(
          variants
        )
        const contracts = [
          { contract, slot },
          ...(atom.forwarded ?? []).map((r) => ({
            contract: componentContract(r.target, system.metadata),
            slot: r.slot,
          })),
        ]
        const protectedProperty =
          ownsTarget &&
          contracts.some(
            ({ contract: c, slot: s }) =>
              c?.slots?.includes(s) &&
              (c.slotOwnership?.[s]?.protected ?? c.protected)?.some(
                (p) => p === '*' || p === property || p === d.category
              ) &&
              !c.slotOwnership?.[s]?.allowed.some(
                (p) => p === '*' || p === property || p === d.category
              )
          )
        const protectedIcon = surface.iconSlot && ['dimensions', 'colours'].includes(d.category)
        const modalSpacing =
          ownsTarget &&
          surface.fieldGroup &&
          (surface.renderContexts ?? [surface.ancestors ?? []]).some(
            (c) =>
              c.find(
                (target) =>
                  !target.includes('#') ||
                  target === '@sim/emcn#ChipModalBody' ||
                  target === '@sim/emcn#ChipModalField'
              ) === '@sim/emcn#ChipModalBody' && !c.includes('@sim/emcn#ChipModalField')
          ) &&
          surface.target === 'div' &&
          (property === 'padding' ||
            (property === 'margin' &&
              atom.kind === 'class' &&
              /^space-y-/.test(utility(atom.value).base)) ||
            (property === 'gap' &&
              surface.atoms.some(
                (a) => a.kind === 'class' && utility(a.value).base === 'flex-col'
              )))
        const rule = protectedIcon
          ? 'icon-slot'
          : protectedProperty || modalSpacing
            ? 'component-chrome'
            : undefined
        if (rule) {
          out.governed++
          if (!emitted.has(`${rule}:${property}`))
            emit(
              rule,
              d.category,
              property,
              comparisonInput(atom, system, d.value),
              atom,
              atom.forwarded?.length
                ? `${registry.rules[rule].permission}; styling forwarded through ${surface.target} -> ${atom.forwarded.map((r) => `${r.target}.${r.slot}`).join(' -> ')}`
                : undefined
            )
          emitted.add(`${rule}:${property}`)
          continue
        }
        if (
          property === 'box-shadow' &&
          atom.kind === 'class' &&
          !/^(?:inset-)?shadow(?:-|$)/.test(utility(atom.value).base)
        ) {
          out.ungoverned++
          continue
        }
        const familyName = governed(property, d.category, system)
        if (!familyName) {
          out.ungoverned++
          continue
        }
        if (
          d.property === 'background-image' &&
          !rawColours(d.value) &&
          !variablesIn(d.value).some((v) => !v.startsWith('--tw-'))
        ) {
          out.ungoverned++
          continue
        }
        out.governed++
        if (
          familyName === 'colours' &&
          variablesIn(atom.value).some((reference) => reference.startsWith('--landing-'))
        ) {
          emit(
            'central-colour',
            d.category,
            property,
            atom.value,
            atom,
            'Landing-only token is not product colour authority'
          )
          continue
        }
        if (atom.reference && system.resolve(atom.reference)) continue
        const value = expand(d.value.replace(/ !important$/, ''))
        if (neutral.test(value)) continue
        const utilityName = named(atom, familyName)
        if (utilityName && system.adopted.get(familyName)?.has(utilityName)) continue
        // Tailwind may inline an @theme inline definition. Keep the original
        // reference as provenance instead of treating its output as a local literal.
        const refs = variablesIn(value).filter((v) => !v.startsWith('--tw-'))
        const sourceRefs = variablesIn(atom.value)
        if (
          atom.property !== 'font' &&
          sourceRefs.length &&
          sourceRefs.every((v) => system.variableFamilies.get(v)?.has(familyName)) &&
          !rawColours(atom.value)
        )
          continue
        if (
          refs.length &&
          refs.every((v) => system.variableFamilies.get(v)?.has(familyName)) &&
          !rawColours(value)
        )
          continue
        const contractName =
          familyName === 'colours'
            ? 'central-colour'
            : familyName === 'border-radius'
              ? 'central-radius'
              : familyName === 'box-shadow'
                ? 'central-shadow'
                : 'central-typography'
        if (!emitted.has(`${contractName}:${property}`))
          emit(contractName, d.category, property, comparisonInput(atom, system, value), atom)
        emitted.add(`${contractName}:${property}`)
      }
    }
  }
  return out
}
function displayInput(atom: Atom | undefined, value: string): string {
  return atom?.partial
    ? value.replace(
        /var\(--lint-dynamic-(\d+)\)/g,
        (_, i) => `\${${atom.partial?.inputs[Number(i)] ?? 'unknown'}}`
      )
    : value
}
function prepared(facts: Facts, file: string, index: SourceIndex): Facts {
  const unchecked = [...facts.unchecked]
  const ownersWithFields = new Set(
    (facts.surfaces ?? []).filter((s) => s.fieldContainer).map((s) => s.owner)
  )
  const surfaces = (facts.surfaces ?? []).map((surface) => {
    if (!surface.atoms.length && !surface.fieldContainer && !surface.structuralViolation)
      return { ...surface, target: index.canonicalTarget(surface.target) }
    const renderContexts = index.contexts(surface, file)
    const ancestors = [...new Set(renderContexts.flat())]
    const modal = renderContexts.some(
      (c) => c.includes('@sim/emcn#ChipModalBody') && !c.includes('@sim/emcn#ChipModalField')
    )
    const atoms = surface.atoms.flatMap((input) => {
      const forwarded =
        surface.componentRef && !index.contract(surface.target)
          ? index.forwarded(surface.componentRef, inputSlot(input))
          : []
      const atom = forwarded.length ? { ...input, forwarded } : input
      if (!atom.pendingRef) return [atom]
      let value = index.value(atom.pendingRef)
      if (value === undefined) {
        unchecked.push({
          line: atom.line,
          context: surface.owner,
          reason: `Imported styling input is unchecked: ${atom.pendingRef}`,
        })
        return []
      }
      if (atom.kind === 'style' && atom.property === 'font-size' && /^\d+(?:\.\d+)?$/.test(value))
        value += 'px'
      const resolved = index.resolve(atom.pendingRef)
      const reference =
        resolved && centralFile(resolved.file)
          ? `${resolved.file.replace(/\.[cm]?[jt]sx?$/, '')}#${resolved.name}`
          : undefined
      return (atom.kind === 'class' ? value.split(/\s+/).filter(Boolean) : [value]).map((v) => ({
        ...atom,
        value: v,
        ...(reference ? { reference } : {}),
        pendingRef: undefined,
      }))
    })
    return {
      ...surface,
      target: index.canonicalTarget(surface.target),
      atoms,
      ancestors,
      renderContexts,
      structuralViolation:
        surface.fieldContainer && modal
          ? `Use ChipModalField for this labelled modal field; rendered through ${[...new Set([...index.chain(surface, file), ...ancestors])].filter((a) => a.includes('#')).join(' -> ')}${index
              .chain(surface, file)
              .flatMap((r) =>
                index.metadata?.exports[r.replace('@sim/emcn#', '')]?.source.file
                  ? [index.metadata.exports[r.replace('@sim/emcn#', '')].source.file]
                  : []
              )
              .map((s) => `; central definition ${s}`)
              .join('')}`
          : ownersWithFields.has(surface.owner)
            ? undefined
            : surface.structuralViolation,
    }
  })
  return { ...facts, surfaces, atoms: surfaces.flatMap((s) => s.atoms), unchecked }
}
/** PR-only occurrence comparison; old violations never authorize additional copies. */
export class ConformanceLinter {
  readonly identity = implementationHash()
  readonly metrics = {
    parsedFiles: 0,
    cacheHits: 0,
    sourceBytes: 0,
    centralBuilds: 0,
    peakSummaryBytes: 0,
  }
  private readonly factsCache = new Map<string, { facts: Facts; bytes: number }>()
  private factsBytes = 0
  private readonly systems = new Map<string, DesignSystem>()
  report(commits: Commits | null, error?: string): Report {
    return {
      schemaVersion: VERSION,
      toolVersion: VERSION,
      policyVersion: registry.policy,
      implementationHash: this.identity,
      catalogueHash: contractsHash,
      catalogueVersion: registry.version,
      catalogueSourceCommit: commits?.mergeBase ?? '',
      contractsHash,
      commits,
      status: error ? 'failed' : 'completed',
      flagged: error ? null : false,
      findings: [],
      unchecked: [],
      coverageFailures: [],
      coverage: {
        checkedFiles: 0,
        excludedFiles: 0,
        unsupportedFiles: 0,
        governedInputs: 0,
        ungovernedInputs: 0,
        violations: 0,
        systemChanges: 0,
      },
      ...(error ? { error } : {}),
    }
  }
  private async system(input: SystemInput): Promise<DesignSystem> {
    const hit = this.systems.get(input.snapshot.hash)
    if (hit) return hit
    const result = await designSystem(input)
    this.metrics.centralBuilds++
    if (this.systems.size >= registry.limits.systemCacheEntries)
      this.systems.delete(this.systems.keys().next().value as string)
    this.systems.set(input.snapshot.hash, result)
    return result
  }
  private facts(source: string, file: string, system: DesignSystem): Facts {
    const key = hash(`${contractsHash}\0${file}\0${system.resolutionHash}\0${source}`)
    const hit = this.factsCache.get(key)
    if (hit) {
      this.metrics.cacheHits++
      return hit.facts
    }
    this.metrics.parsedFiles++
    this.metrics.sourceBytes += Buffer.byteLength(source)
    const facts = extract(source, file, true, {
      conformance: true,
      resolve: system.resolve,
      contract: (target) => componentContract(target, system.metadata),
    })
    const bytes = Buffer.byteLength(canonical(facts))
    while (this.factsBytes + bytes > registry.limits.factsCacheBytes && this.factsCache.size) {
      const k = this.factsCache.keys().next().value as string
      this.factsBytes -= this.factsCache.get(k)?.bytes ?? 0
      this.factsCache.delete(k)
    }
    if (bytes <= registry.limits.factsCacheBytes) {
      this.factsCache.set(key, { facts, bytes })
      this.factsBytes += bytes
    }
    return facts
  }
  async analyze(
    changes: Change[],
    read: (entry: Entry) => string,
    commits: Commits,
    input: SystemInput
  ): Promise<Report> {
    const report = this.report(commits)
    try {
      if (input.snapshot.commit !== commits.mergeBase)
        throw new Error('Central snapshot does not match merge-base')
      assertRecipeSnapshot(
        input.snapshot,
        changes.flatMap((c) => (c.before ? [c.before] : []))
      )
      const old = await this.system(input)
      const entries = new Map(input.snapshot.entries.map((e) => [e.path, e]))
      const proposed = new Map<string, string>()
      for (const c of changes) {
        if (c.before && centralInventory(c.before.path)) entries.delete(c.before.path)
        if (c.after && centralInventory(c.after.path)) {
          entries.set(c.after.path, c.after)
          proposed.set(c.after.blob, read(c.after))
        }
      }
      const nextEntries = [...entries.values()].sort((a, b) => compareStrings(a.path, b.path))
      const afterInput: SystemInput = {
        snapshot: {
          version: '1.0.0',
          commit: commits.head,
          entries: nextEntries,
          ...(input.snapshot.recipeInventory
            ? { recipeInventory: input.snapshot.recipeInventory }
            : {}),
          hash: snapshotHash(nextEntries, input.snapshot.recipeInventory),
        },
        read: (e) => proposed.get(e.blob) ?? input.read(e),
        unchecked: input.unchecked,
      }
      const next = afterInput.snapshot.hash === old.hash ? old : await this.system(afterInput)
      report.centralSourceHashes = { before: old.hash, after: next.hash }
      // Public API and ownership decisions are design changes even after regeneration.
      for (const name of new Set([
        ...Object.keys(old.metadata.exports),
        ...Object.keys(next.metadata.exports),
      ])) {
        const before = old.metadata.exports[name]
        const after = next.metadata.exports[name]
        const semantic = (entry: typeof before) =>
          entry
            ? canonical({ ...entry, source: { file: entry.source.file, name: entry.source.name } })
            : null
        if (semantic(before) === semantic(after)) continue
        const source = after?.source ?? before?.source
        if (!source || registry.artwork?.brandAssets?.[source.file]) continue
        report.findings.push({
          kind: 'system-change',
          rule: 'central-definition',
          contract: 'central-definition',
          category: 'component-api',
          property: 'public-design-contract',
          value: semantic(after) ?? '<removed>',
          before: semantic(before),
          file: source.file,
          line: source.line,
          column: 1,
          context: name,
          reason:
            'Public design API or source ownership metadata changed; regenerate infrastructure and review the originating decision',
        })
      }
      const raw = new Map<Change, { before: Facts; after: Facts }>()
      const centralItems = (system: DesignSystem) =>
        system.summaries.map(({ file, summary }) => ({
          file,
          facts: { atoms: [], surfaces: [], unchecked: [], syntax: summary } as Facts,
        }))
      const beforeItems: { file: string; facts: Facts }[] = centralItems(old)
      const afterItems: { file: string; facts: Facts }[] = centralItems(next)
      for (const change of changes) {
        const get = (e: Entry | null, s: DesignSystem): Facts =>
          e &&
          !artworkFile(e.path) &&
          productScope(e.path) === 'check' &&
          /^100(?:644|755)$/.test(e.mode)
            ? this.facts(read(e), e.path, s)
            : { atoms: [], surfaces: [], unchecked: [] }
        const pair = { before: get(change.before, old), after: get(change.after, next) }
        raw.set(change, pair)
        if (change.before) beforeItems.push({ file: change.before.path, facts: pair.before })
        if (change.after) afterItems.push({ file: change.after.path, facts: pair.after })
      }
      const summaryBudget = { bytes: 0 }
      const beforeIndex = new SourceIndex(
        beforeItems,
        registry.limits.summaryBytes,
        summaryBudget,
        old.metadata
      )
      const afterIndex = new SourceIndex(
        afterItems,
        registry.limits.summaryBytes,
        summaryBudget,
        next.metadata
      )
      beforeItems.length = 0
      afterItems.length = 0
      const centralBefore = new Map<string, Facts>()
      for (const change of changes)
        if (change.before && centralFile(change.before.path)) {
          const facts = raw.get(change)?.before
          if (facts)
            centralBefore.set(change.before.path, prepared(facts, change.before.path, beforeIndex))
        }
      // Relocate individual source-owned facts only when the old export demonstrably delegates.
      for (const [file, facts] of [...centralBefore]) {
        for (const owner of new Set((facts.surfaces ?? []).map((s) => s.owner))) {
          const mapping = afterIndex.extraction(beforeIndex, file, owner, 'direct')
          if (!mapping || mapping.copies !== 1 || !centralFile(mapping.file)) continue
          const moved = (facts.surfaces ?? [])
            .filter((s) => s.owner === owner)
            .map((s) => ({ ...s, owner: mapping.owner }))
          const current = centralBefore.get(file) ?? facts
          const kept = (current.surfaces ?? []).filter((s) => s.owner !== owner)
          centralBefore.set(file, {
            ...current,
            surfaces: kept,
            atoms: kept.flatMap((s) => s.atoms),
          })
          const dest = centralBefore.get(mapping.file) ?? { atoms: [], surfaces: [], unchecked: [] }
          centralBefore.set(mapping.file, {
            ...dest,
            surfaces: [...(dest.surfaces ?? []), ...moved],
            atoms: [...dest.atoms, ...moved.flatMap((s) => s.atoms)],
          })
        }
      }
      for (const [side, system] of [
        ['before', old],
        ['after', next],
      ] as const)
        for (const note of system.unchecked)
          report.unchecked.push({ ...note, line: 1, context: 'central-theme', side })
      for (const change of changes) {
        const file = (change.after ?? change.before)?.path as string
        if (isRegistry(file)) {
          const b = change.before ? JSON.parse(read(change.before)) : null
          const a = change.after ? JSON.parse(read(change.after)) : null
          if (canonical(b) !== canonical(a))
            report.findings.push({
              kind: 'system-change',
              contract: 'central-definition',
              rule: 'central-definition',
              category: 'contracts',
              property: 'registry',
              value: hash(canonical(a)),
              before: hash(canonical(b)),
              reason: 'Design-system contract registry changed',
              file,
              line: 1,
              column: 1,
              context: 'contract-registry',
              provenance: {
                source: 'contracts.json',
                input: 'contract registry',
                permitted: 'Designer review of the changed standard',
              },
            })
          continue
        }
        const beforeArtwork = change.before && artworkFile(change.before.path)
        const afterArtwork = change.after && artworkFile(change.after.path)
        if (beforeArtwork || afterArtwork) {
          const result = artworkDiff(
            {
              ...change,
              before: beforeArtwork ? change.before : null,
              after: afterArtwork ? change.after : null,
            },
            read
          )
          report.findings.push(...result.findings)
          report.unchecked.push(
            ...result.unchecked.map((n) => ({ ...n, file, side: 'comparison' }))
          )
          if (afterArtwork || !change.after) {
            report.coverage.checkedFiles++
            continue
          }
        }
        if (registry.artwork?.brandingFiles.includes(file))
          report.unchecked.push({
            file,
            side: 'comparison',
            line: 1,
            context: 'artwork-ownership',
            reason:
              'Legacy mixed branding/icon library remains excluded until provider artwork and product artwork have separate ownership',
          })
        if (![change.before, change.after].some((e) => e && productScope(e.path) === 'check')) {
          if (productScope(file) === 'unsupported') {
            report.coverage.unsupportedFiles++
            report.unchecked.push({
              file,
              side: 'after',
              line: 1,
              context: '',
              reason: 'Unsupported file format; no styling inspected',
            })
          } else report.coverage.excludedFiles++
          continue
        }
        report.coverage.checkedFiles++
        const get = (e: Entry | null, facts: Facts, index: SourceIndex): Facts => {
          if (!e || productScope(e.path) !== 'check')
            return { atoms: [], surfaces: [], unchecked: [] }
          if (!/^100(?:644|755)$/.test(e.mode))
            return {
              atoms: [],
              surfaces: [],
              unchecked: [{ line: 1, context: '', reason: 'Symlink/submodule is not followed' }],
            }
          return prepared(facts, e.path, index)
        }
        const withDefinitions = (
          facts: Facts,
          file: string | undefined,
          system: DesignSystem
        ): Facts => {
          const atoms = file ? (system.definitions[file] ?? []) : []
          return atoms.length
            ? {
                ...facts,
                atoms: [...facts.atoms, ...atoms],
                surfaces: [
                  ...(facts.surfaces ?? []),
                  {
                    kind: 'definition',
                    owner: 'central-config',
                    target: 'configuration',
                    shared: false,
                    line: 1,
                    column: 1,
                    atoms,
                    references: [],
                  },
                ],
              }
            : facts
        }
        const pair = raw.get(change)
        if (!pair) throw new Error('Missing changed-source facts')
        raw.delete(change)
        const before = withDefinitions(
          centralBefore.get(change.before?.path ?? change.after?.path ?? '') ??
            get(change.before, pair.before, beforeIndex),
          change.before?.path,
          old
        )
        const after = withDefinitions(
          get(change.after, pair.after, afterIndex),
          change.after?.path,
          next
        )
        centralBefore.delete(change.before?.path ?? change.after?.path ?? '')
        if (registry.centralRecipes?.[file]) {
          report.findings.push(
            ...recipeDiff(file, old.recipes[change.before?.path ?? file], next.recipes[file])
          )
          continue
        }
        if ([change.before, change.after].some((e) => e && centralFile(e.path))) {
          report.findings.push(...localArtworkDiff(pair.before, pair.after, change, true))
          for (const [side, facts] of [
            ['before', before],
            ['after', after],
          ] as const)
            for (const note of facts.unchecked) report.unchecked.push({ ...note, file, side })
          const converted = (f: Facts, system: DesignSystem): Facts => ({
            ...f,
            atoms: f.atoms.map((a) => compilationAtom(a, system)),
            surfaces: f.surfaces?.map((s) => ({
              ...s,
              kind: 'definition' as const,
              target: registry.transparentPrimitives?.[s.target]?.target ?? s.target,
              atoms: s.atoms.map((a) => compilationAtom(a, system)),
            })),
          })
          // Token declarations are compared here too; the legacy global-token special case is not used.
          const compared = appearanceDiff(
            converted(before, old),
            converted(after, next),
            file === TOKEN_FILE ? 'central.css' : file,
            next.compiler,
            next.catalogue
          )
          for (const f of compared.findings) {
            const owner = f.context.split(' / ')[0]
            const candidates = [...(after.surfaces ?? []), ...(before.surfaces ?? [])]
              .filter((s) => s.owner === owner)
              .flatMap((s) => s.atoms)
            const located = candidates.find(
              (a) => a.property === f.property && f.context.includes(a.context)
            )
            const partialAtom = located?.partial
              ? located
              : candidates.find((a) => a.partial && a.property === f.property)
            report.findings.push({
              ...f,
              value: displayInput(partialAtom, f.value),
              ...(f.before ? { before: displayInput(partialAtom, f.before) } : {}),
              file,
              line: located?.line ?? f.line,
              column: located?.column ?? f.column,
              kind: 'system-change',
              contract: 'central-definition',
              rule: 'central-definition',
              reason:
                configurationExplanation(file, f) ??
                `Design-system definition changed: ${displayInput(partialAtom, f.reason)}${partialAtom ? '; explicit recipe structure; dynamic colour parameter remains unresolved' : ''}`,
              provenance: {
                source: file,
                input: displayInput(partialAtom, f.value),
                permitted: registry.rules['central-definition'].permission,
              },
            })
          }
          for (const note of compared.unchecked)
            report.unchecked.push({ ...note, file, side: 'comparison' })
          continue
        }
        report.findings.push(...localArtworkDiff(pair.before, pair.after, change))
        const b = inspect(before, change.before?.path ?? file, old)
        const a = inspect(after, file, next)
        for (const [side, r] of [
          ['before', b],
          ['after', a],
        ] as const)
          for (const note of r.unchecked) report.unchecked.push({ ...note, file, side })
        report.coverage.governedInputs = (report.coverage.governedInputs ?? 0) + a.governed
        report.coverage.ungovernedInputs = (report.coverage.ungovernedInputs ?? 0) + a.ungoverned
        const failures = [
          ...before.unchecked.map((n) => ({
            ...n,
            file: change.before?.path ?? file,
            side: 'before' as const,
          })),
          ...after.unchecked.map((n) => ({ ...n, file, side: 'after' as const })),
        ].filter((n) => inspectionFailure(n.reason))
        if (failures.length) {
          report.coverageFailures?.push(...failures)
          continue
        }
        /**
         * Debt is preserved only within its existing file and source owner. Extracting
         * or renaming noncompliant styling surfaces it for review under this policy.
         */
        const sameFile = change.before?.path === change.after?.path
        const context = (f: Finding) => f.context
        const key = (f: Finding) =>
          canonical([f.rule, f.property, f.provenance?.input ?? f.value, context(f)])
        const buckets = new Map<string, Finding[]>()
        if (sameFile)
          for (const f of b.findings) {
            const bucket = buckets.get(key(f)) ?? []
            bucket.push(f)
            buckets.set(key(f), bucket)
          }
        const pending = a.findings.filter((f) => !buckets.get(key(f))?.shift())
        report.findings.push(...pending)
      }
      for (const [side, index] of [
        ['before', beforeIndex],
        ['after', afterIndex],
      ] as const)
        for (const note of index.notes)
          report.unchecked.push({ ...note, file: note.file ?? note.context.split('#')[0], side })
      report.findings.sort((a, b) =>
        compareStrings(
          canonical([a.file, a.line, a.column, a.rule, a.property, a.value, a.context]),
          canonical([b.file, b.line, b.column, b.rule, b.property, b.value, b.context])
        )
      )
      report.unchecked = [...new Map(report.unchecked.map((n) => [canonical(n), n])).values()].sort(
        (a, b) => compareStrings(canonical(a), canonical(b))
      )
      report.coverage.violations = report.findings.filter(
        (f) => f.kind === 'usage-violation'
      ).length
      report.coverage.systemChanges = report.findings.filter(
        (f) => f.kind === 'system-change'
      ).length
      report.flagged = report.findings.length > 0
      if (report.coverageFailures?.length) {
        report.status = 'failed'
        report.flagged = null
        report.error = `${report.coverageFailures.length} changed product file inspection failure(s); comparison incomplete`
      }
      this.metrics.peakSummaryBytes = Math.max(this.metrics.peakSummaryBytes, summaryBudget.bytes)
      beforeIndex.release()
      afterIndex.release()
      raw.clear()
      centralBefore.clear()
      return report
    } catch (error) {
      return this.report(
        commits,
        error instanceof Error ? error.message : 'Conformance analysis failed'
      )
    }
  }
}
