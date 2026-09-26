import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { ColourAssignmentReport } from '#control-analysis/colour-assignments'
import type { ControlInventory } from '#control-analysis/inventory'
import type { LayoutAllowance } from '#control-analysis/layout-allowances'
import type { ReviewReport } from '#control-analysis/review'
import type { ReviewDecisions } from '#control-analysis/review-ledger'
import type { ShadowExtrasReport } from '#control-analysis/shadow-extras'
import type { SimplificationReport } from '#control-analysis/simplifications'
import type { TypographyReview } from '#control-analysis/typography'
import { canonical, hash } from '#design-conformance/model'
import { compare } from '#design-conformance/worktree-source'
import type { Inventory, InventoryFinding } from './inventory'

export interface Group {
  id: string
  rule: string
  property: string
  input: string
  authoritativeSource: string
  permitted: string
  occurrences: number
  files: string[]
  findingIds: string[]
}

export function groups(findings: InventoryFinding[]): Group[] {
  const all = new Map<string, Group>()
  for (const f of findings) {
    const input = f.provenance?.input ?? f.value
    const source = f.provenance?.source ?? ''
    const permitted = f.provenance?.permitted ?? ''
    const id = hash(canonical([f.rule, f.property, input, source, permitted]))
    let group = all.get(id)
    if (!group) {
      group = {
        id,
        rule: f.rule,
        property: f.property,
        input,
        authoritativeSource: source,
        permitted,
        occurrences: 0,
        files: [],
        findingIds: [],
      }
      all.set(id, group)
    }
    group.occurrences++
    group.files.push(f.file)
    group.findingIds.push(f.id)
  }
  return [...all.values()]
    .map((g) => ({
      ...g,
      files: [...new Set(g.files)].sort(compare),
      findingIds: g.findingIds.sort(compare),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || compare(a.id, b.id))
}

/** Keep spreadsheet viewers from interpreting source text as formulas. JSON stays exact. */
export function csv(rows: (string | number)[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value)
          const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text
          return `"${safe.replaceAll('"', '""')}"`
        })
        .join(',')
    )
    .join('\n')}\n`
}
const md = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replace(/[\\`*_[\]{}|]/g, '\\$&')

export function summary(inventory: Inventory, grouped = groups(inventory.findings)): string {
  const rules = new Map<string, number>()
  for (const f of inventory.findings) rules.set(f.rule, (rules.get(f.rule) ?? 0) + 1)
  return [
    '# Existing design-conformance inventory',
    '',
    `Source: ${inventory.mode}; base commit: \`${inventory.commit}\`. Policy: design-conformance/1.3.0.`,
    '',
    `**${inventory.findings.length} styling rule findings in ${inventory.coverage.filesWithFindings} files; ${inventory.unchecked.length} unchecked diagnostics.**`,
    '',
    'This is existing source debt, not a PR diff or a runtime appearance assessment. All findings start unreviewed. Central definitions are authoritative inputs and do not generate system-change notifications in this mode.',
    '',
    '## Coverage',
    '',
    '| File classification | Count |',
    '| --- | ---: |',
    ...Object.entries(inventory.coverage.files).map(([key, n]) => `| ${key} | ${n} |`),
    '',
    `${inventory.coverage.governedInputs} governed and ${inventory.coverage.ungovernedInputs} ungoverned input checks in each file's own inspection context. Additional caller contexts can contribute findings without increasing these input counts.`,
    '',
    '## Rules',
    '',
    '| Rule | Occurrences |',
    '| --- | ---: |',
    ...[...rules].sort(([a], [b]) => compare(a, b)).map(([rule, n]) => `| ${md(rule)} | ${n} |`),
    '',
    '## Repeated patterns',
    '',
    'Groups are for review, not automatic replacement. Identical literal values can have different semantic roles. All locations are in findings.csv / findings.json; every group is in groups.json and triage.csv.',
    '',
    '| Rule | Input (preview) | Occurrences | Files | Group |',
    '| --- | --- | ---: | ---: | --- |',
    ...grouped
      .slice(0, 100)
      .map(
        (g) =>
          `| ${md(g.rule)} | ${md(g.input.slice(0, 160))} | ${g.occurrences} | ${g.files.length} | ${g.id.slice(0, 12)} |`
      ),
    '',
    '## Classification and cleanup',
    '',
    'Record review decisions in triage.csv: routine-fix, designer-decision, explained-exception, or false-positive, with a concrete rationale. A grouping never supplies missing provenance or grants an exemption. Keep original finding IDs and JSON unchanged. Fix confirmed issues in focused PRs using existing tokens, props or recipes; do not create a token for every literal or pick replacements by numerical closeness alone.',
    '',
    '## Limits',
    '',
    ...inventory.limitations.map((text) => `- ${text}`),
    '',
    'Unchecked diagnostics are coverage gaps, not violations and not proof of conformance. No code, contract, Git state or application configuration was modified by this scan.',
    '',
  ].join('\n')
}

/** Resolve existing ancestors so a symlink cannot redirect output into the source checkout. */
export function validateOutput(output: string, repo: string): string {
  const resolved = path.resolve(output)
  if (existsSync(resolved)) throw new Error('Output directory already exists; choose a new path')
  let ancestor = path.dirname(resolved)
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const actual = path.resolve(realpathSync(ancestor), path.relative(ancestor, resolved))
  const relative = path.relative(realpathSync(repo), actual)
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new Error('Output must be outside the scanned repository')
  return actual
}

/** Publish complete results atomically; a failed run never leaves a successful-looking report. */
export function writeResults(
  output: string,
  inventory: Inventory,
  identity: unknown,
  metrics: unknown,
  controls?: ControlInventory,
  simplifications?: SimplificationReport,
  colourAssignments?: ColourAssignmentReport,
  shadowExtras?: ShadowExtrasReport,
  typographyReview?: TypographyReview,
  layoutAllowances: LayoutAllowance[] = [],
  review?: ReviewReport,
  reviewDecisions?: ReviewDecisions
): void {
  if (existsSync(output)) throw new Error('Output directory already exists; refusing to overwrite')
  mkdirSync(path.dirname(output), { recursive: true })
  const temp = mkdtempSync(path.join(path.dirname(output), '.conformance-inventory-'))
  const json = (name: string, value: unknown) =>
    writeFileSync(path.join(temp, name), `${JSON.stringify(value, null, 2)}\n`)
  try {
    const grouped = groups(inventory.findings)
    json('findings.json', inventory.findings)
    json('groups.json', grouped)
    json('unchecked.json', inventory.unchecked)
    const coverageFailures = inventory.unchecked.filter((note) =>
      /^(?:Parser failure|Extraction failure|Source exceeds)/.test(note.reason)
    )
    json('coverage-failures.json', coverageFailures)
    if (review) json('review-items.json', review.items)
    if (reviewDecisions) json('review-decisions.json', reviewDecisions)
    json('coverage.json', inventory.coverage)
    json('identity.json', {
      mode: inventory.mode,
      status: inventory.status,
      commit: inventory.commit,
      centralHash: inventory.centralHash,
      treeHash: inventory.treeHash,
      scanner: identity,
      limitations: inventory.limitations,
    })
    json('metrics.json', metrics)
    if (colourAssignments) json('colour-assignments.json', colourAssignments)
    if (shadowExtras) json('shadow-extras.json', shadowExtras)
    if (typographyReview) json('typography-review.json', typographyReview)
    json('layout-allowances.json', layoutAllowances)
    if (simplifications) {
      json('simplifications.json', simplifications)
      writeFileSync(
        path.join(temp, 'simplifications.csv'),
        csv([
          ['id', 'file', 'line', 'column', 'rule', 'value', 'reason', 'proof', 'related_findings'],
          ...simplifications.findings.map((f) => [
            f.id,
            f.file,
            f.line,
            f.column,
            f.rule,
            f.value,
            f.reason,
            JSON.stringify(f.proof),
            f.relatedFindingIds.join('; '),
          ]),
        ])
      )
      writeFileSync(
        path.join(temp, 'simplifications-summary.md'),
        [
          '# Control simplifications',
          '',
          `${simplifications.findings.length} source-proven findings; ${simplifications.unchecked.length} explicit analysis gaps.`,
          '',
          'These counts are separate from the frozen styling rules and may overlap them. No automatic edits or Extra approvals.',
          '',
          ...Object.entries(simplifications.coverage).map(([key, count]) => `- ${key}: ${count}`),
          '',
          'Complete evidence and remaining uncertainty: simplifications.json. Source locations: simplifications.csv.',
          '',
        ].join('\n')
      )
    }
    if (controls) {
      json('controls.json', controls)
      json('control-unchecked.json', controls.unchecked)
      json('control-non-ui.json', controls.nonUi)
      json('assessment.json', {
        stylingRuleFindings: inventory.findings.length,
        colourAssignments: colourAssignments?.coverage,
        verifiedColourUsages: colourAssignments?.verifiedUsages.length,
        shadowExtras: shadowExtras
          ? { approved: shadowExtras.approved.length, guards: shadowExtras.findings.length }
          : undefined,
        simplificationFindings: simplifications?.findings.length ?? 0,
        simplificationDiagnostics: simplifications?.unchecked.length ?? 0,
        stylingAnalysisDiagnostics: inventory.unchecked.length,
        stylingCoverageFailures: coverageFailures.length,
        advisoryReviewItems: review?.items.length ?? 0,
        reviewedExtras:
          reviewDecisions?.matches.filter((item) => item.status === 'retained-extra').length ?? 0,
        staleReviewDecisions: reviewDecisions?.stale.length ?? 0,
        ambiguousReviewDecisions: reviewDecisions?.ambiguous.length ?? 0,
        controlAnalysisDiagnostics: controls.unchecked.length,
        controlOrigins: controls.counts,
        provenNonUi: controls.nonUi.length,
        appearanceUnresolved: controls.records.filter((r) => r.appearance.status === 'unresolved')
          .length,
        centralRecipeOccurrences: controls.records.filter((r) => r.appearance.centralRecipes.length)
          .length,
        recordsWithDirectFindings: controls.records.filter((r) => r.findingIds.length).length,
        behavioralDelegations: controls.records.filter((r) =>
          r.relationship.includes('delegates-to-child')
        ).length,
        exhaustiveConformanceEstablished: false,
        note: 'Local controls and unknown inputs are review items, not automatically violations or Extras. Counts include wrapper projections.',
      })
      writeFileSync(
        path.join(temp, 'controls.csv'),
        csv([
          [
            'id',
            'file',
            'line',
            'owner',
            'tag',
            'origin',
            'area',
            'projection',
            'multiplicity',
            'inputs',
            'renderer_evidence',
            'styling_finding_ids',
            'nearby_finding_ids',
            'review',
            'relationship',
            'styling_owners',
            'appearance',
          ],
          ...controls.records.map((r) => [
            r.id,
            r.file,
            r.line,
            r.owner,
            r.tag,
            r.origin,
            r.area,
            String(r.projection),
            r.multiplicity,
            JSON.stringify(r.inputs),
            r.evidence.join('; '),
            r.findingIds.join('; '),
            r.potentialFindingIds.join('; '),
            r.review,
            r.relationship.join('; '),
            r.stylingOwners.join('; '),
            JSON.stringify(r.appearance),
          ]),
        ])
      )
      writeFileSync(
        path.join(temp, 'controls-summary.md'),
        [
          '# Control origins',
          '',
          `Source: ${inventory.mode}; base commit: \`${inventory.commit}\`.`,
          '',
          `${controls.records.length} source candidates, including central implementations and wrapper projections. These are not distinct visible button counts.`,
          '',
          '| Origin | Source occurrences |',
          '| --- | ---: |',
          ...Object.entries(controls.counts).map(([k, v]) => `| ${k} | ${v} |`),
          '',
          'Renderer origin, appearance provenance and behavioral delegation are independent. A central renderer may retain local styles; a central recipe does not provide semantics or authorize overrides. Appearance resolution describes bounded source inputs, not measured runtime CSS.',
          '',
          `${controls.records.filter((r) => r.findingIds.length).length} records have directly associated styling findings; ${controls.records.filter((r) => r.appearance.status === 'unresolved').length} retain unresolved appearance; ${controls.records.filter((r) => r.appearance.centralRecipes.length).length} reference supported central recipes.`,
          '',
          `${controls.nonUi.length} proven non-UI diagnostics are recorded with evidence in control-non-ui.json. They are not exclusions or styling approvals.`,
          '',
          '## Areas',
          '',
          '| Area | Origins |',
          '| --- | --- |',
          ...Object.entries(controls.byArea).map(
            ([k, v]) =>
              `| ${md(k)} | ${Object.entries(v)
                .map(([n, c]) => `${n}: ${c}`)
                .join('; ')} |`
          ),
          '',
          '## Analysis limits',
          '',
          ...controls.limitations.map((l) => `- ${l}`),
          '',
          `${controls.unchecked.length} control-analysis diagnostics remain explicit in control-unchecked.json.`,
          '',
        ].join('\n')
      )
    }
    writeFileSync(
      path.join(temp, 'summary.md'),
      summary(inventory, grouped) +
        (colourAssignments
          ? `\n## Verified local colour usages\n\n${colourAssignments.verifiedUsages.length} alias usage warnings resolved by checked global-token assignments and fallbacks. Evidence is in colour-assignments.json. Unresolved assignments and coverage gaps remain reported; this does not prove runtime CSS cascade.\n`
          : '') +
        (shadowExtras
          ? `\n## Reviewed shadow Extras\n\n${shadowExtras.approved.length} exact effects classified separately; ${shadowExtras.findings.length} failed recipe guards. See shadow-extras.json for sites and reasons. This classification does not exempt their other styling.\n`
          : '') +
        `\n## External layout allowances\n\n${layoutAllowances.length} resolved wrapper-growth or modal-viewport declarations are reported separately in layout-allowances.json. Other styling and all unresolved inputs remain governed.\n`
    )
    writeFileSync(
      path.join(temp, 'findings.csv'),
      csv([
        [
          'id',
          'file',
          'line',
          'column',
          'rule',
          'property',
          'input',
          'reason',
          'authoritative_source',
          'permitted',
          'context',
          'observed_from',
        ],
        ...inventory.findings.map((f) => [
          f.id,
          f.file,
          f.line,
          f.column,
          f.rule,
          f.property,
          f.provenance?.input ?? f.value,
          f.reason,
          f.provenance?.source ?? '',
          f.provenance?.permitted ?? '',
          f.context,
          f.observedFrom.join('; '),
        ]),
      ])
    )
    writeFileSync(
      path.join(temp, 'triage.csv'),
      csv([
        [
          'group_id',
          'rule',
          'property',
          'input',
          'occurrences',
          'files',
          'status',
          'decision',
          'notes',
        ],
        ...grouped.map((g) => [
          g.id,
          g.rule,
          g.property,
          g.input,
          g.occurrences,
          g.files.join('; '),
          'unreviewed',
          '',
          '',
        ]),
      ])
    )
    renameSync(temp, output)
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    throw error
  }
}
