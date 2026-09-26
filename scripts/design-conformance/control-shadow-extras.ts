import postcss, { type Rule } from 'postcss'
import valueParser from 'postcss-value-parser'
import type { ColourAssignmentReport } from '#control-analysis/colour-assignments'
import {
  type ControlSource,
  type Diagnostic,
  type InventoryFinding,
  regular,
} from '#control-analysis/model'
import { canonical, type Finding, hash, TOKEN_FILE } from '#design-conformance/model'

/** Reviewed one-off effects, not a general permission for shadows with token colours. */
const editor =
  'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
const loader =
  'apps/sim/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-loading-bar.module.css'
const treatments = [
  {
    id: 'document-selection-light',
    file: editor,
    selector: '.rich-markdown-nodes hr.rich-leaf-in-selection',
    declarations: [
      ['box-shadow', '0 0 0 0.4em var(--selection-bg)'],
      ['border-radius', '1px'],
    ],
    colours: ['--selection-bg'],
    reason: 'Selection band around a textless divider without changing document layout',
  },
  {
    id: 'document-selection-dark',
    file: editor,
    selector: '.dark .rich-markdown-nodes hr.rich-leaf-in-selection',
    declarations: [['box-shadow', '0 0 0 0.4em var(--selection-dark)']],
    colours: ['--selection-dark'],
    reason: 'Dark-theme selection band around a textless divider',
  },
  {
    id: 'browser-loading-glow',
    file: loader,
    selector: '.indicator',
    declarations: [
      ['position', 'absolute'],
      ['top', '0'],
      ['bottom', '0'],
      ['left', '0'],
      ['width', '100%'],
      ['transform', 'scaleX(0.08)'],
      ['transform-origin', 'left'],
      [
        'background',
        'linear-gradient(90deg, var(--thinking-ink-inner), var(--thinking-ink-outer))',
      ],
      ['box-shadow', '0 0 3px color-mix(in srgb, var(--thinking-ink-outer) 55%, transparent)'],
      ['animation', 'browser-page-loading 12s ease-out forwards'],
    ],
    colours: ['--thinking-ink-inner', '--thinking-ink-outer'],
    reason: 'Small progress-indicator glow, not surface elevation',
  },
]

/** Ignore formatting/comments only; retain token boundaries, units, functions and every layer. */
function value(text: string): string {
  const nodes = (parts: valueParser.Node[]): unknown[] =>
    parts.flatMap((node) =>
      node.type === 'space' || node.type === 'comment'
        ? []
        : [
            node.type === 'function'
              ? [node.type, node.value, !!node.unclosed, nodes(node.nodes)]
              : [node.type, node.value],
          ]
    )
  return canonical(nodes(valueParser(text).nodes))
}
const declarations = (rule: Rule) =>
  rule.nodes
    .filter((n) => n.type !== 'comment')
    .map((node) =>
      node.type === 'decl'
        ? [node.prop, value(node.value), !!node.important]
        : ['unsupported', node.toString()]
    )

export interface ShadowExtra {
  id: string
  file: string
  selector: string
  line: number
  column: number
  value: string
  reason: string
  colourTokens: string[]
}
export interface ShadowExtrasReport {
  version: '1.0.0'
  approved: ShadowExtra[]
  findings: InventoryFinding[]
  unchecked: Diagnostic[]
}

/** Validate exact source sites before removing a shadow-family finding. Fail closed on drift. */
export function inspectShadowExtras(
  source: ControlSource,
  globalColour: (name: string) => boolean,
  colours: ColourAssignmentReport
): ShadowExtrasReport {
  const report: ShadowExtrasReport = { version: '1.0.0', approved: [], findings: [], unchecked: [] }
  for (const file of [...new Set(treatments.map((item) => item.file))].sort()) {
    const entry = source.entries.find((item) => item.path === file)
    if (!entry) continue
    try {
      if (!regular(entry) || entry.bytes > 2 * 1024 * 1024)
        throw new Error('Unsupported source or parsing limit')
      const root = postcss.parse(source.read(entry))
      for (const treatment of treatments.filter((item) => item.file === file)) {
        const rules: Rule[] = []
        root.walkRules((rule) => {
          if (rule.selector.trim() === treatment.selector) rules.push(rule)
        })
        const roots = rules.filter((rule) => rule.parent?.type === 'root')
        const expected = canonical(
          treatment.declarations.map(([prop, text]) => [prop, value(text), false])
        )
        const validColours = treatment.colours.every(
          (name) => globalColour(name) && !colours.assignments.some((a) => a.name === name)
        )
        for (const rule of rules) {
          const shape = canonical(declarations(rule))
          const valid =
            rule.parent?.type === 'root' && roots.length === 1 && shape === expected && validColours
          for (const decl of rule.nodes) {
            if (decl.type !== 'decl' || decl.prop !== 'box-shadow') continue
            const site = {
              id: treatment.id,
              file,
              selector: treatment.selector,
              line: decl.source?.start?.line ?? 1,
              column: decl.source?.start?.column ?? 1,
              value: decl.value,
              reason: treatment.reason,
              colourTokens: treatment.colours,
            }
            if (valid) report.approved.push(site)
            else {
              const input = canonical({
                treatment: treatment.id,
                shape,
                root: rule.parent?.type === 'root',
                roots: roots.length,
                validColours,
              })
              report.findings.push({
                id: hash(canonical([file, site.line, input])),
                observedFrom: [file],
                kind: 'usage-violation',
                contract: 'central-shadow',
                rule: 'central-shadow',
                category: 'effects',
                property: 'box-shadow',
                file,
                line: site.line,
                column: site.column,
                context: `reviewed effect / ${treatment.selector}`,
                value: input,
                reason:
                  'Reviewed shadow effect changed: exact root selector, unique rule, declaration geometry and unshadowed global colour tokens are required',
                provenance: {
                  source: `control-shadow-extras.ts#${treatment.id}`,
                  input: decl.value,
                  permitted: `${treatment.reason}; colours must resolve to ${TOKEN_FILE}`,
                },
              })
            }
          }
        }
      }
    } catch (error) {
      report.unchecked.push({
        file,
        line: 1,
        context: 'shadow extras',
        reason: `No shadow exception approved: ${String(error)}`,
      })
    }
  }
  return report
}

/** Only the shadow finding is reclassified; colour, radius and other rules remain independent. */
export function withoutApprovedShadows<T extends Finding>(
  findings: T[],
  report: ShadowExtrasReport
): T[] {
  return findings.filter(
    (f) =>
      !(
        f.rule === 'central-shadow' &&
        f.property === 'box-shadow' &&
        report.approved.some(
          (a) =>
            f.file === a.file &&
            f.line === a.line &&
            f.column === a.column &&
            value(f.provenance?.input ?? f.value) === value(a.value)
        )
      )
  )
}

/** Avoid emitting the ordinary shadow warning and its stricter guard twice at one declaration. */
export function mergeShadowFindings<T extends Finding>(findings: T[], guards: T[]): T[] {
  const retained = findings.filter(
    (f) =>
      !guards.some(
        (g) =>
          f.rule === 'central-shadow' &&
          f.file === g.file &&
          f.line === g.line &&
          f.column === g.column
      )
  )
  return [...retained, ...guards]
}
