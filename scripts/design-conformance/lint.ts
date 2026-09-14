import { appearanceDiff } from '#design-conformance/appearance'
import { extract } from '#design-conformance/extract'
import {
  type Atom,
  CATALOGUE_VERSION,
  type Catalogue,
  type Change,
  type Commits,
  canonical,
  type Facts,
  type Finding,
  hash,
  implementationHash,
  type Policy,
  policyVersion,
  type Report,
  scope,
  TOKEN_FILE,
  VERSION,
} from '#design-conformance/model'
import {
  type Compiler,
  compiler,
  declarations,
  normalizeValue,
  rawColours,
  utility,
  variablesIn,
} from '#design-conformance/normalize'

/** A bounded in-process facts cache. ASTs are never retained. */
export class Linter {
  private readonly cache = new Map<string, { facts: Facts; bytes: number }>()
  private cacheBytes = 0
  readonly metrics = { parsedFiles: 0, cacheHits: 0, sourceBytes: 0 }
  private readonly colourTokens: Set<string>
  private constructor(
    readonly catalogue: Catalogue,
    readonly catalogueHash: string,
    readonly system: Compiler,
    readonly identity: string,
    readonly policy: Policy
  ) {
    this.colourTokens = new Set(catalogue.colourTokens)
    for (let depth = 0; depth < 8; depth++)
      for (const token of [...this.colourTokens]) {
        for (const value of catalogue.variables[token] ?? [])
          for (const referenced of variablesIn(value)) {
            if (catalogue.variables[referenced]) this.colourTokens.add(referenced)
          }
      }
  }
  static async create(
    catalogue: Catalogue,
    catalogueHash = hash(canonical(catalogue)),
    policy: Policy = 'appearance'
  ) {
    if (
      catalogue.version !== CATALOGUE_VERSION ||
      !catalogue.theme ||
      !catalogue.allowed ||
      !catalogue.variables ||
      !Array.isArray(catalogue.colourTokens)
    )
      throw new Error('Invalid or incompatible catalogue')
    return new Linter(
      catalogue,
      catalogueHash,
      await compiler(catalogue.theme),
      implementationHash(),
      policy
    )
  }
  private facts(source: string, file: string): Facts {
    const key = hash(`${file}\0${source}`)
    const hit = this.cache.get(key)
    if (hit) {
      this.metrics.cacheHits++
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit.facts
    }
    this.metrics.parsedFiles++
    this.metrics.sourceBytes += Buffer.byteLength(source)
    const facts = extract(source, file, this.policy === 'appearance')
    const bytes = Buffer.byteLength(canonical(facts))
    while (this.cacheBytes + bytes > 64 * 1024 * 1024 && this.cache.size) {
      const oldest = this.cache.keys().next().value as string
      this.cacheBytes -= this.cache.get(oldest)?.bytes ?? 0
      this.cache.delete(oldest)
    }
    if (bytes <= 64 * 1024 * 1024) {
      this.cache.set(key, { facts, bytes })
      this.cacheBytes += bytes
    }
    return facts
  }
  report(commits: Commits | null, error?: string): Report {
    return {
      schemaVersion: VERSION,
      toolVersion: VERSION,
      policyVersion: policyVersion(this.policy),
      implementationHash: this.identity,
      catalogueHash: this.catalogueHash,
      catalogueVersion: this.catalogue.version,
      catalogueSourceCommit: this.catalogue.sourceCommit,
      commits,
      status: error ? 'failed' : 'completed',
      flagged: error ? null : false,
      findings: [],
      unchecked: [],
      coverage: { checkedFiles: 0, excludedFiles: 0, unsupportedFiles: 0 },
      ...(error ? { error } : {}),
    }
  }
  private inspect(
    facts: Facts,
    file: string
  ): { findings: Finding[]; unchecked: Facts['unchecked'] } {
    const findings: Finding[] = []
    const unchecked = [...facts.unchecked]
    const tokens = this.colourTokens
    for (const atom of facts.atoms) {
      if (atom.kind === 'token') continue
      const context = atom.kind === 'class' ? utility(atom.value).variants : atom.context
      const fail = (
        rule: string,
        category: string,
        property: string,
        value: string,
        reason: string
      ) =>
        findings.push({
          rule,
          category,
          property,
          value,
          reason,
          file,
          line: atom.line,
          column: atom.column,
          context,
        })
      const note = (reason: string) => unchecked.push({ line: atom.line, context, reason })
      let ds: ReturnType<typeof declarations>
      try {
        ds = declarations(atom, this.system, this.catalogue.variables)
      } catch {
        note('Utility/CSS declaration could not be parsed')
        continue
      }
      if (ds === null) {
        note(`Unsupported or custom utility: ${atom.value}`)
        continue
      }
      const { base } = utility(atom.value)
      const arbitrary = atom.kind === 'class' && /\[|\(/.test(base)
      for (const d of ds) {
        const referenced = variablesIn(d.value).filter((x) => !x.startsWith('--tw-'))
        if (d.category === 'colours') {
          const unknown = referenced.filter((x) => !tokens.has(x))
          if (unknown.length) {
            fail(
              'unknown-colour-token',
              d.category,
              d.property,
              d.value,
              `Colour token is not in the frozen catalogue: ${unknown.join(', ')}`
            )
            continue
          }
          const named = base.match(
            /^(?:text|bg|border(?:-[trblxyse])?|outline|ring(?:-offset)?|fill|stroke|decoration|from|via|to|accent|caret)-(.+?)(?:\/[\d.]+)?$/
          )?.[1]
          const permittedName =
            named !== undefined &&
            (tokens.has(`--color-${named}`) ||
              ['current', 'transparent', 'inherit'].includes(named))
          const approvedNamed =
            atom.kind === 'class' &&
            !arbitrary &&
            (permittedName ||
              /^(?:currentColor|transparent|inherit)$/.test(d.value) ||
              referenced.length > 0 ||
              /^(?:text|bg|border|outline|ring|fill|stroke|decoration|from|via|to)-(?:white|black)(?:\/\d+)?$/.test(
                base
              ))
          if (!approvedNamed && rawColours(d.value)) {
            fail(
              'colour-token-required',
              d.category,
              d.property,
              d.value,
              'Use an approved colour token or named utility instead of a literal colour'
            )
            continue
          }
          if (
            !referenced.length &&
            !approvedNamed &&
            !/^(?:none|inherit|initial|unset|currentColor|transparent)$/.test(d.value) &&
            d.property !== 'background-image'
          )
            fail(
              'unapproved-colour',
              d.category,
              d.property,
              d.value,
              'Colour value is not an approved token reference'
            )
          continue
        }
        if (rawColours(d.value) && (atom.kind === 'style' || arbitrary)) {
          fail(
            'colour-token-required',
            'colours',
            d.property,
            d.value,
            'Composite styling contains a literal colour; use an approved token'
          )
          continue
        }
        if (this.catalogue.allowed[d.property]?.includes(d.value)) continue
        if (/^(?:inherit|initial|unset|revert|revert-layer)$/.test(d.value)) continue
        if (/var\(|(?:calc|min|max|clamp)\(/.test(d.value)) {
          note(`Dynamic or unresolved ${d.property}: ${d.value}`)
          continue
        }
        fail(
          'unapproved-value',
          d.category,
          d.property,
          d.value,
          `Value is outside the frozen ${d.property} catalogue`
        )
      }
    }
    return { findings, unchecked }
  }
  /** Compare per-file violation multisets; permitted-to-permitted edits intentionally pass. */
  analyze(
    changes: Change[],
    read: (entry: NonNullable<Change['before']>) => string,
    commits: Commits
  ): Report {
    const report = this.report(commits)
    const key = (f: Finding) => canonical([f.rule, f.property, f.value, f.context])
    try {
      for (const change of changes) {
        const beforeFile = change.before?.path
        const afterFile = change.after?.path
        const file = afterFile ?? beforeFile ?? ''
        const states = [beforeFile, afterFile].filter(Boolean).map((f) => scope(f as string))
        if (!states.includes('check')) {
          if (states.includes('unsupported')) {
            report.coverage.unsupportedFiles++
            report.unchecked.push({
              file,
              side: 'after',
              line: 1,
              context: '',
              reason: 'Unsupported file format; no styles inspected',
            })
          } else report.coverage.excludedFiles++
          continue
        }
        report.coverage.checkedFiles++
        const get = (entry: Change['before']): Facts => {
          if (!entry || scope(entry.path) !== 'check') return { atoms: [], unchecked: [] }
          if (!/^100(?:644|755)$/.test(entry.mode))
            return {
              atoms: [],
              unchecked: [
                { line: 1, context: '', reason: 'Symlink/submodule is data and is not followed' },
              ],
            }
          return this.facts(read(entry), entry.path)
        }
        const before = get(change.before)
        const after = get(change.after)
        const b =
          this.policy === 'tokens'
            ? this.inspect(before, beforeFile ?? file)
            : { findings: [], unchecked: before.unchecked }
        const a =
          this.policy === 'tokens'
            ? this.inspect(after, afterFile ?? file)
            : { findings: [], unchecked: after.unchecked }
        if (this.policy === 'appearance') {
          const compared = appearanceDiff(before, after, file, this.system, this.catalogue)
          report.findings.push(...compared.findings)
          for (const note of compared.unchecked)
            report.unchecked.push({ ...note, file, side: 'comparison' })
        }
        for (const [side, result] of [
          ['before', b],
          ['after', a],
        ] as const)
          for (const note of result.unchecked)
            report.unchecked.push({
              ...note,
              file: side === 'before' ? (beforeFile ?? file) : (afterFile ?? file),
              side,
            })
        const counts = new Map<string, number>()
        for (const f of b.findings) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1)
        for (const f of a.findings) {
          const n = counts.get(key(f)) ?? 0
          if (n > 0) counts.set(key(f), n - 1)
          else report.findings.push(f)
        }
        if (beforeFile === TOKEN_FILE || afterFile === TOKEN_FILE) {
          const tokens = (facts: Facts) => {
            const entries = new Map<string, Atom[]>()
            for (const atom of facts.atoms.filter((x) => x.kind === 'token')) {
              const k = canonical([
                atom.property,
                atom.context
                  .replace(/\s+/g, ' ')
                  .replace(/\s*,\s*/g, ',')
                  .trim(),
              ])
              entries.set(k, [...(entries.get(k) ?? []), atom])
            }
            return entries
          }
          const old = tokens(before)
          const next = tokens(after)
          const value = (atoms?: Atom[]) =>
            canonical(
              (atoms ?? []).map((x) =>
                normalizeValue(x.value).replace(/#[a-f\d]+/gi, (x) => x.toLowerCase())
              )
            )
          for (const k of new Set([...old.keys(), ...next.keys()])) {
            if (value(old.get(k)) === value(next.get(k))) continue
            const atom = next.get(k)?.[0] ?? old.get(k)?.[0]
            if (!atom) continue
            report.findings.push({
              rule: 'token-definition-changed',
              category: 'token-definitions',
              property: atom.property,
              value: next.has(k) ? value(next.get(k)) : '<removed>',
              before: old.has(k) ? value(old.get(k)) : null,
              reason:
                'Central token definition changed; proposed definitions do not update the frozen catalogue',
              file,
              line: atom.line,
              column: atom.column,
              context: atom.context,
            })
          }
        }
      }
      report.findings.sort((a, b) =>
        canonical([a.file, a.line, a.column, a.rule, a.property, a.value, a.context]).localeCompare(
          canonical([b.file, b.line, b.column, b.rule, b.property, b.value, b.context])
        )
      )
      report.unchecked = [...new Map(report.unchecked.map((x) => [canonical(x), x])).values()].sort(
        (a, b) => canonical(a).localeCompare(canonical(b))
      )
      report.flagged = report.findings.length > 0
      return report
    } catch (error) {
      return this.report(commits, error instanceof Error ? error.message : 'Source analysis failed')
    }
  }
}
