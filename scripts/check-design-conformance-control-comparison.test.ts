import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { inspectSimplifications } from '#control-analysis/simplifications'
import { warningExitCode } from '#design-conformance/ci'
import { checkComparison } from '#design-conformance/command'
import { compareSimplifications, controlSource } from '#design-conformance/control-comparison'
import { git } from '#design-conformance/io'

const temp = mkdtempSync(path.join(os.tmpdir(), 'control-comparison-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))
const ui = 'apps/sim/components/example.tsx'
function put(repo: string, file: string, source: string) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  writeFileSync(path.join(repo, file), source)
}
function commit(repo: string) {
  git(repo, ['add', '.'])
  git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'fixture',
  ])
  return git(repo, ['rev-parse', 'HEAD']).toString().trim()
}

test('immutable full snapshots resolve unchanged imports, preserve debt, and warn for another occurrence', async () => {
  const repo = mkdtempSync(path.join(temp, 'repo-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  put(
    repo,
    'packages/emcn/src/icons/mark.tsx',
    `export function Mark(){ return <svg aria-hidden='true' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16'/></svg> }`
  )
  put(repo, 'packages/emcn/src/icons/index.ts', `export {Mark} from './mark'`)
  const view = (count: number) =>
    `import {Mark} from '@sim/emcn/icons'; export const View=()=> <div>${'<button><Mark/></button>'.repeat(count)}</div>`
  put(repo, ui, view(1))
  const base = commit(repo)
  put(repo, ui, `\n\n${view(2)}`)
  const head = commit(repo)
  put(repo, ui, `throw new Error('Uncommitted work must not execute or affect results')`)
  const before = inspectSimplifications(controlSource(repo, base)).simplifications
  const after = inspectSimplifications(controlSource(repo, head)).simplifications
  expect(before.findings.filter((f) => f.rule === 'control-accessible-name')).toHaveLength(1)
  expect(after.findings.filter((f) => f.rule === 'control-accessible-name')).toHaveLength(2)
  expect(compareSimplifications(before, after).map((f) => f.rule)).toEqual([
    'control-accessible-name',
  ])
  expect(compareSimplifications(after, before)).toEqual([])
  const report = await checkComparison({ repo, base, head, policy: 'conformance' })
  expect(report.status).toBe('completed')
  expect(report.controlSimplifications?.introduced).toBe(1)
  expect(report.findings.filter((f) => f.rule === 'control-accessible-name')).toHaveLength(1)
  expect(warningExitCode(1, null, report)).toBe(0)
  expect(() => controlSource(repo, 'HEAD')).toThrow('immutable commit')
})

test('an assignment-only edit is a new finding even when the colour usage already has baseline debt', async () => {
  const repo = mkdtempSync(path.join(temp, 'colour-writer-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  put(repo, 'apps/sim/components/cursor.css', '.cursor { color: var(--caret-color); }')
  const writer = (value: string) =>
    `export function update(node){ node.style.setProperty('--caret-color', ${value}) }`
  put(repo, ui, writer("'var(--text-body)'"))
  const base = commit(repo)
  put(repo, ui, writer("'var(--missing)'"))
  const head = commit(repo)
  const report = await checkComparison({ repo, base, head, policy: 'conformance' })
  expect(report.status).toBe('completed')
  expect(report.colourAssignments?.before.verified).toBe(1)
  expect(report.colourAssignments?.introduced).toBe(1)
  expect(
    report.findings.filter((finding) => finding.rule === 'central-colour-assignment')
  ).toHaveLength(1)
  expect(report.flagged).toBe(true)
  put(repo, ui, `\n\n${writer("'var(--missing)'")}`)
  const shifted = commit(repo)
  expect(
    (await checkComparison({ repo, base: head, head: shifted, policy: 'conformance' }))
      .colourAssignments?.introduced
  ).toBe(0)
  put(repo, ui, writer("'var(--different-missing)'"))
  const changed = commit(repo)
  expect(
    (await checkComparison({ repo, base: shifted, head: changed, policy: 'conformance' }))
      .colourAssignments?.introduced
  ).toBe(1)
})

test('source-only status colours remain advisory while all block metadata colours are intentional', async () => {
  const repo = mkdtempSync(path.join(temp, 'source-colours-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  const status = (value: string) => `export function Status({active}) {
    let color: string
    if (active) color = '${value}'
    else color = 'bg-red-400/90'
    return <span className={color}/>
  }`
  const block = 'apps/sim/blocks/blocks/example.ts'
  const provider = 'apps/sim/blocks/blocks/provider.ts'
  const trigger = 'apps/sim/blocks/blocks/trigger.ts'
  put(repo, ui, status('bg-emerald-400/90'))
  put(
    repo,
    block,
    `export const metadata={category:'blocks',bgColor:'#123456',iconColor:'#abcdef'}`
  )
  put(
    repo,
    provider,
    `export const metadata={category:'tools',bgColor:'#123456',iconColor:'#abcdef'}`
  )
  put(repo, trigger, `export const metadata={category:'triggers',bgColor:'#123456'}`)
  const base = commit(repo)
  put(repo, ui, status('bg-amber-400/90'))
  put(
    repo,
    block,
    `export const metadata={category:'blocks',bgColor:'#654321',iconColor:'#abcdef'}`
  )
  put(
    repo,
    provider,
    `export const metadata={category:'tools',bgColor:'#654321',iconColor:'#abcdef'}`
  )
  put(repo, trigger, `export const metadata={category:'triggers',bgColor:'#654321'}`)
  const head = commit(repo)
  const report = await checkComparison({ repo, base, head, policy: 'conformance' })
  expect(report.status).toBe('completed')
  expect(
    report.reviewItems?.some(
      (item) => item.kind === 'semantic-status-colour' && item.value === 'bg-amber-400/90'
    )
  ).toBe(true)
  expect(report.reviewItems?.some((item) => [block, provider, trigger].includes(item.file))).toBe(
    false
  )
  put(repo, ui, `\n\n${status('bg-amber-400/90')}`)
  const shifted = commit(repo)
  const shiftReport = await checkComparison({
    repo,
    base: head,
    head: shifted,
    policy: 'conformance',
  })
  expect(shiftReport.reviewItems?.filter((item) => item.kind === 'semantic-status-colour')).toEqual(
    []
  )
})

test('block files still review colours outside registered block metadata', async () => {
  const repo = mkdtempSync(path.join(temp, 'block-ui-colour-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  const block = 'apps/sim/blocks/blocks/example.ts'
  const source = (value: string) =>
    `export const metadata={category:'blocks',bgColor:'#123456'}; export const palette={bgColor:'${value}'}`
  put(repo, block, source('#111111'))
  const base = commit(repo)
  put(repo, block, source('#222222'))
  const head = commit(repo)
  const report = await checkComparison({ repo, base, head, policy: 'conformance' })
  expect(report.reviewItems?.some((item) => item.kind === 'block-colour')).toBe(true)
  expect(report.reviewItems?.some((item) => item.value === 'bgColor: #123456')).toBe(false)
})

test('Monaco theme-only edits stay quiet while adjacent product colour edits are reported', async () => {
  const repo = mkdtempSync(path.join(temp, 'monaco-theme-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  const source = (theme: string, product: string) => `
    const rules=[{token:'keyword',foreground:'33b4ff'}]
    monaco.editor.defineTheme('dark',{rules,colors:{'editor.background':'${theme}'}})
    export const View=()=> <p className='text-[${product}]'>Text</p>`
  put(repo, ui, source('#1b1b1b', '#123456'))
  const base = commit(repo)
  put(repo, ui, source('#242424', '#123456'))
  const changedTheme = commit(repo)
  const themeReport = await checkComparison({
    repo,
    base,
    head: changedTheme,
    policy: 'conformance',
  })
  expect(themeReport.findings.filter((finding) => finding.rule === 'central-colour')).toEqual([])
  expect(themeReport.reviewItems?.filter((item) => item.kind === 'syntax-colour')).toEqual([])
  put(repo, ui, source('#242424', '#654321'))
  const changedProduct = commit(repo)
  const productReport = await checkComparison({
    repo,
    base: changedTheme,
    head: changedProduct,
    policy: 'conformance',
  })
  expect(productReport.findings.some((finding) => finding.value.includes('#654321'))).toBe(true)
})

test('direct product colour branches are checked while data-only and customer colours stay out of the source rule', () => {
  const source = (code: string) => ({
    entries: [
      {
        path: 'apps/sim/app/_styles/globals.css',
        bytes: 32,
        kind: 'blob',
        mode: '100644',
        blob: 'a'.repeat(40),
      },
      {
        path: ui,
        bytes: Buffer.byteLength(code),
        kind: 'blob',
        mode: '100644',
        blob: 'b'.repeat(40),
      },
    ],
    read: (entry: { path: string }) =>
      entry.path === ui ? code : ':root { --text-body: #434343; }',
  })
  const product = inspectSimplifications(
    source(
      `export const View=({active})=><span style={{color: active?'#ff00ff':'var(--text-body)'}}/>`
    )
  )
  expect(product.colourAssignments.findings.some((f) => f.value.includes('#ff00ff'))).toBe(true)
  const data = inspectSimplifications(
    source(
      `export const payload={colour:'#ff00ff'}; export const View=({customerColor})=><span style={{color:customerColor}}/>`
    )
  )
  expect(data.colourAssignments.findings.some((f) => f.value.includes('#ff00ff'))).toBe(false)
})

test('an imported assignment value or global-token removal exposes unchanged consumers', async () => {
  const repo = mkdtempSync(path.join(temp, 'colour-dependency-'))
  git(repo, ['init', '-q'])
  const global = 'apps/sim/app/_styles/globals.css'
  const palette = 'apps/sim/components/palette.ts'
  put(repo, global, ':root { --text-body: #434343; }')
  put(repo, palette, `export const ink='var(--text-body)'`)
  put(
    repo,
    ui,
    `import {ink} from './palette'; export const View=()=> <span style={{'--rest':ink, color:'var(--rest)'}}/>`
  )
  const base = commit(repo)
  put(repo, palette, `export const ink='#ff00ff'`)
  const head = commit(repo)
  expect(
    (await checkComparison({ repo, base, head, policy: 'conformance' })).colourAssignments
      ?.introduced
  ).toBeGreaterThanOrEqual(1)
  put(repo, palette, `export const ink='var(--text-body)'`)
  put(repo, global, ':root { --text-other: #434343; }')
  const removed = commit(repo)
  expect(
    (await checkComparison({ repo, base, head: removed, policy: 'conformance' })).colourAssignments
      ?.introduced
  ).toBeGreaterThanOrEqual(1)
})

test('changing a computed imported palette source reports an unchanged style consumer', async () => {
  const repo = mkdtempSync(path.join(temp, 'computed-palette-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  const palette = 'apps/sim/components/palette.ts'
  put(repo, palette, `export const colours={ready:{color:'var(--text-body)'}}`)
  put(
    repo,
    ui,
    `import {colours} from './palette'; export const View=({status})=><span style={{color:colours[status].color}}/>`
  )
  const base = commit(repo)
  put(repo, palette, `export const colours={ready:{color:'#ff00ff'}}`)
  const head = commit(repo)
  const report = await checkComparison({ repo, base, head, policy: 'conformance' })
  expect(report.status).toBe('completed')
  expect(
    report.findings.some(
      (finding) =>
        finding.file === ui &&
        finding.rule === 'central-colour-assignment' &&
        finding.value.includes('#ff00ff')
    )
  ).toBe(true)
  expect(
    report.unchecked.some(
      (note) => note.file === ui && note.reason.includes('unresolved provenance')
    )
  ).toBe(true)
})

test('registered EMCN chrome is reported once when both analysis passes see it', async () => {
  const repo = mkdtempSync(path.join(temp, 'chrome-overlap-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  put(repo, 'packages/emcn/src/index.ts', `export { Badge } from './components/badge'`)
  put(
    repo,
    'packages/emcn/src/components/badge.tsx',
    `export function Badge(props){return <span {...props}/>} `
  )
  put(repo, ui, `import {Badge} from '@sim/emcn'; export const View=()=> <Badge>OK</Badge>`)
  const base = commit(repo)
  put(
    repo,
    ui,
    `import {Badge} from '@sim/emcn'; export const View=()=> <Badge className='p-8'>OK</Badge>`
  )
  const head = commit(repo)
  const report = await checkComparison({ repo, base, head, policy: 'conformance' })
  expect(
    report.findings.filter(
      (finding) => finding.rule === 'component-chrome' && finding.value === 'p-8'
    )
  ).toHaveLength(1)
})

test('changing a reviewed effect recipe or deleting its colour revokes approval despite unchanged shadow text', async () => {
  const repo = mkdtempSync(path.join(temp, 'shadow-extra-'))
  git(repo, ['init', '-q'])
  const global = 'apps/sim/app/_styles/globals.css'
  const css =
    'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
  const tokens = ':root { --selection-bg: #add6ff; --shadow-subtle: 0 2px 4px #000; }'
  const rule =
    '.rich-markdown-nodes hr.rich-leaf-in-selection { box-shadow: 0 0 0 0.4em var(--selection-bg); border-radius: 1px; }'
  put(repo, global, tokens)
  const empty = commit(repo)
  put(repo, css, rule)
  const base = commit(repo)
  const introduced = await checkComparison({ repo, base: empty, head: base, policy: 'conformance' })
  expect(introduced.shadowExtras).toHaveLength(1)
  expect(introduced.findings.filter((f) => f.rule === 'central-shadow')).toEqual([])
  put(repo, css, rule.replace('border-radius: 1px', 'border-radius: 2px'))
  const changed = commit(repo)
  const report = await checkComparison({ repo, base, head: changed, policy: 'conformance' })
  expect(report.findings.filter((f) => f.rule === 'central-shadow')).toHaveLength(1)
  expect(report.shadowExtras).toHaveLength(0)
  put(repo, css, rule)
  put(repo, global, tokens.replace('--selection-bg: #add6ff;', ''))
  const removed = commit(repo)
  expect(
    (await checkComparison({ repo, base, head: removed, policy: 'conformance' })).findings.filter(
      (f) => f.rule === 'central-shadow'
    )
  ).toHaveLength(1)
})

test('public diff checks approve a verified colour usage but still flag fallbacks and removed writers', async () => {
  const repo = mkdtempSync(path.join(temp, 'colour-usage-'))
  git(repo, ['init', '-q'])
  put(
    repo,
    'apps/sim/app/_styles/globals.css',
    ':root { --text-body: #434343; --text-muted: #777; }'
  )
  const css = 'apps/sim/components/shimmer.module.css'
  const rule = '.label {color: var(--rest, var(--text-body));}'
  put(repo, ui, `export const View=()=> <span className='[--rest:var(--text-muted)]'/>`)
  const empty = commit(repo)
  put(repo, css, rule)
  const valid = commit(repo)
  const report = await checkComparison({ repo, base: empty, head: valid, policy: 'conformance' })
  expect(report.findings.filter((f) => f.rule === 'central-colour')).toEqual([])
  expect(report.colourAssignments?.verifiedUsages).toHaveLength(1)
  put(repo, css, rule.replace('var(--text-body)', 'hotpink'))
  const badFallback = commit(repo)
  expect(
    (
      await checkComparison({ repo, base: valid, head: badFallback, policy: 'conformance' })
    ).findings.some((f) => f.rule === 'central-colour')
  ).toBe(true)
  put(repo, css, rule)
  unlinkSync(path.join(repo, ui))
  const removed = commit(repo)
  const lost = await checkComparison({ repo, base: valid, head: removed, policy: 'conformance' })
  expect(
    lost.findings.some(
      (f) => f.rule === 'central-colour' && f.reason.includes('last checked assignment')
    )
  ).toBe(true)
  expect(lost.flagged).toBe(true)
})

test('editing an imported style helper revokes an unchanged consumer approval', async () => {
  const repo = mkdtempSync(path.join(temp, 'style-helper-'))
  git(repo, ['init', '-q'])
  const helper = 'apps/sim/components/dimensions.ts'
  put(repo, 'apps/sim/app/_styles/globals.css', ':root { --text-body: #434343; }')
  put(repo, helper, `export const dimensions=()=>({width:runtime})`)
  put(
    repo,
    ui,
    `import {dimensions} from './dimensions';export const View=()=> <span style={dimensions()}/>`
  )
  const base = commit(repo)
  for (const body of [
    "{width:runtime,color:'hotpink'}",
    '{width:runtime,...opaque}',
    "{width:runtime,'--ink':'var(--missing)'}",
  ]) {
    put(repo, helper, `export const dimensions=()=>(${body})`)
    const head = commit(repo)
    const report = await checkComparison({ repo, base, head, policy: 'conformance' })
    expect(report.status).toBe('completed')
    expect((report.colourAssignments?.introduced ?? 0) + report.unchecked.length).toBeGreaterThan(0)
    if (body.includes('hotpink') || body.includes('var(--missing)'))
      expect(report.flagged).toBe(true)
  }
})

test('public diff checker separates layout allowances and exposes a later internal override', async () => {
  const repo = mkdtempSync(path.join(temp, 'layout-'))
  git(repo, ['init', '-q'])
  put(repo, 'apps/sim/app/_styles/globals.css', '@theme { --spacing: .25rem; }')
  put(repo, ui, 'export const View=()=> <div/>')
  const base = commit(repo)
  const view = (classes: string) =>
    `import {ChipModalField as Field, ChipModal} from '@sim/emcn'; export const View=({props})=> <><Field className=${JSON.stringify(classes)} {...props}/><ChipModal className='h-[90vh]'/></>`
  put(repo, ui, view('flex-1'))
  const layoutHead = commit(repo)
  const allowed = await checkComparison({ repo, base, head: layoutHead, policy: 'conformance' })
  expect(allowed.layoutAllowances).toHaveLength(2)
  expect(allowed.findings.some((f) => f.rule === 'component-chrome')).toBe(false)
  expect(allowed.unchecked.length).toBeGreaterThan(0)
  put(repo, ui, view('flex-1 p-4 flex-row'))
  const head = commit(repo)
  const changed = await checkComparison({ repo, base: layoutHead, head, policy: 'conformance' })
  expect(changed.findings.some((f) => f.value === 'p-4')).toBe(true)
  expect(changed.findings.some((f) => f.value === 'flex-row')).toBe(true)
})
