import { expect, test } from 'vitest'
import type { ControlSource } from '#control-analysis/model'
import { mergeShadowFindings, withoutApprovedShadows } from '#control-analysis/shadow-extras'
import { inspectSimplifications } from '#control-analysis/simplifications'

const css =
  'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
const loader =
  'apps/sim/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-loading-bar.module.css'
const globals = 'apps/sim/app/_styles/globals.css'
const selection =
  '.rich-markdown-nodes hr.rich-leaf-in-selection { box-shadow: 0 0 0 0.4em var(--selection-bg); border-radius: 1px; }'
const dark =
  '.dark .rich-markdown-nodes hr.rich-leaf-in-selection { box-shadow: 0 0 0 0.4em var(--selection-dark); }'
const glow = `.indicator { position: absolute; top: 0; bottom: 0; left: 0; width: 100%; transform: scaleX(0.08); transform-origin: left; background: linear-gradient(90deg, var(--thinking-ink-inner), var(--thinking-ink-outer)); box-shadow: 0 0 3px color-mix(in srgb, var(--thinking-ink-outer) 55%, transparent); animation: browser-page-loading 12s ease-out forwards; }`
const defaults = {
  [globals]:
    ':root { --selection-bg: #add6ff; --selection-dark: #264f78; --thinking-ink-inner: #2c2c2c; --thinking-ink-outer: #5f5f5f; }',
  [css]: selection + dark,
  [loader]: glow,
}
const source = (files: Record<string, string>): ControlSource => ({
  entries: Object.entries(files).map(([path, text]) => ({
    path,
    bytes: Buffer.byteLength(text),
    kind: 'blob',
    mode: '100644',
    blob: 'a'.repeat(40),
  })),
  read: (entry) => files[entry.path],
})
const inspect = (files: Record<string, string> = {}) =>
  inspectSimplifications(source({ ...defaults, ...files })).shadowExtras
const finding = (report = inspect()) => {
  const a = report.approved[0]
  return {
    kind: 'usage-violation' as const,
    contract: 'central-shadow',
    rule: 'central-shadow',
    category: 'effects',
    property: 'box-shadow',
    file: a.file,
    line: a.line,
    column: a.column,
    value: a.value,
    context: a.selector,
    reason: 'shadow-family',
  }
}

test('only the three reviewed effects are approved and formatting does not supply extra permission', () => {
  expect(inspect().approved).toHaveLength(3)
  expect(inspect().findings).toEqual([])
  const formatted = inspect({
    [css]: `${selection.replace('0.4em', '/* same spread */ 0.4em')}\n${dark}`,
  })
  expect(formatted.approved).toHaveLength(3)
})

test('geometry, layers, literals, missing tokens, fallbacks and important cannot use the exception', () => {
  for (const replacement of [
    '0 0 0 4em var(--selection-bg)',
    '0 0 5px 0.4em var(--selection-bg)',
    '0 0 0 0.4em red',
    '0 0 0 0.4em var(--missing)',
    '0 0 0 0.4em var(--selection-bg, red)',
    '0 0 0 0.4em var(--selection-bg), 0 0 20px black',
    '0 0 0 0.4em var(--selection-bg) !important',
  ]) {
    const result = inspect({
      [css]: selection.replace('0 0 0 0.4em var(--selection-bg)', replacement),
    })
    expect(result.approved.some((a) => a.id === 'document-selection-light')).toBe(false)
    expect(result.findings).toHaveLength(1)
  }
})

test('a whitelist cannot be obtained by copying the selector or value to another file', () => {
  const result = inspect({ [css]: '', 'apps/sim/components/copied.css': selection })
  expect(result.approved).toHaveLength(1)
  const original = finding()
  const moved = { ...original, file: 'apps/sim/components/copied.css' }
  expect(withoutApprovedShadows([moved], result)).toEqual([moved])
})

test('broader selectors and nested contexts are not approved', () => {
  for (const text of [
    selection.replace('hr.rich-leaf-in-selection', '*'),
    selection.replace(' {', ', .button {'),
    `@media (min-width: 1px) {${selection}}`,
    `@supports (display: grid) {${selection}}`,
  ]) {
    const report = inspect({ [css]: text })
    expect(report.approved.some((a) => a.id === 'document-selection-light')).toBe(false)
    const raw = finding()
    expect(withoutApprovedShadows([raw], report)).toEqual([raw])
  }
})

test('duplicate rules or declarations revoke approval instead of increasing an exemption budget', () => {
  for (const text of [
    selection + selection,
    selection.replace(
      'border-radius',
      'box-shadow: 0 0 0 0.4em var(--selection-bg); border-radius'
    ),
    `${selection}.rich-markdown-nodes hr.rich-leaf-in-selection { width: 100vw; }`,
  ]) {
    const result = inspect({ [css]: text })
    expect(result.approved.some((a) => a.id === 'document-selection-light')).toBe(false)
    expect(result.findings.length).toBeGreaterThan(0)
  }
})

test('global-token removal, wrong families and local overrides revoke approval', () => {
  const changes: Record<string, string>[] = [
    { [globals]: defaults[globals].replace('--selection-bg: #add6ff;', '') },
    { [globals]: defaults[globals].replace('#add6ff', '8px') },
    { 'apps/sim/components/override.css': '.elsewhere { --selection-bg: #ff0000; }' },
    {
      'apps/sim/components/override.tsx': `export const View=()=> <div style={{'--selection-bg':'var(--selection-dark)'}}/>`,
    },
  ]
  for (const files of changes) {
    const result = inspect(files)
    expect(result.approved.some((a) => a.id === 'document-selection-light')).toBe(false)
    expect(result.findings.length).toBeGreaterThan(0)
  }
})

test('the glow exception fixes opacity, palette, geometry and the surrounding indicator recipe', () => {
  for (const text of [
    glow.replace('55%', '95%'),
    glow.replace('3px', '8px'),
    glow.replace('width: 100%', 'width: 100vw'),
    glow.replace('--thinking-ink-outer', '--selection-bg'),
  ]) {
    const report = inspect({ [loader]: text })
    expect(report.approved.some((a) => a.id === 'browser-loading-glow')).toBe(false)
    expect(report.findings).toHaveLength(1)
  }
})

test('only a matching shadow-family finding is removed; other rules, values and locations survive', () => {
  const report = inspect()
  const raw = finding(report)
  const others = [
    { ...raw, rule: 'central-colour' },
    { ...raw, line: raw.line + 1 },
    { ...raw, column: raw.column + 1 },
    { ...raw, value: '0 0 8px black' },
    { ...raw, file: 'apps/sim/components/other.css' },
  ]
  expect(withoutApprovedShadows([raw, ...others], report)).toEqual(others)
  const guard = { ...raw, reason: 'guard' }
  expect(mergeShadowFindings([raw, others[0]], [guard])).toEqual([others[0], guard])
})

test('parse failures never approve an effect and discovery order does not change the report', () => {
  expect(inspect({ [css]: `${selection} {` }).unchecked).toHaveLength(1)
  expect(inspect({ [css]: `${selection} {` }).approved).toHaveLength(1)
  const forward = inspectSimplifications(source(defaults)).shadowExtras
  const input = source(defaults)
  input.entries.reverse()
  expect(inspectSimplifications(input).shadowExtras).toEqual(forward)
})
