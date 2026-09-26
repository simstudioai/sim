import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { ControlSource } from '#control-analysis/model'
import { ReviewCollector } from '#control-analysis/review'
import { findingFingerprint, matchReviews } from '#control-analysis/review-ledger'
import { productScope } from '#control-analysis/scope'
import { inspectSimplifications } from '#control-analysis/simplifications'
import { extract } from '#design-conformance/extract'
import type { GeneratedContracts } from '#design-conformance/generated-contracts'

const globals = 'apps/sim/app/_styles/globals.css'
const ui = 'apps/sim/components/example.tsx'
function source(files: Record<string, string>): ControlSource {
  return {
    entries: Object.entries(files).map(([path, text]) => ({
      path,
      bytes: Buffer.byteLength(text),
      kind: 'blob',
      mode: '100644',
      blob: 'a'.repeat(40),
    })),
    read: (entry) => files[entry.path],
  }
}
const metadata = JSON.parse(
  readFileSync('scripts/design-conformance/contracts.generated.json', 'utf8')
) as GeneratedContracts
const inspect = (files: Record<string, string>) =>
  inspectSimplifications(
    source({
      [globals]: ':root { --caution: #f59e0b; --color-yellow-500: #eab308; --text-body: #444; }',
      ...files,
    }),
    [],
    'forward',
    undefined,
    undefined,
    undefined,
    metadata
  )

test('browser desktop UI is checked while landing, docs, native desktop and API remain excluded', () => {
  expect(productScope('apps/sim/app/desktop/auth/page.tsx')).toBe('check')
  expect(
    productScope('apps/sim/app/workspace/[workspaceId]/settings/components/desktop/desktop.tsx')
  ).toBe('check')
  for (const file of [
    'apps/sim/app/(landing)/page.tsx',
    'apps/sim/app/(docs)/page.tsx',
    'apps/sim/app/design-studio/components/page.tsx',
    'apps/desktop/src/main.tsx',
    'apps/sim/lib/desktop/appearance.ts',
    'apps/sim/tools/generated/tool-metadata.ts',
    'apps/sim/app/api/desktop/auth/route.ts',
  ])
    expect(productScope(file)).toBe('exclude')
})

test('landing, docs and marketing helper contents are never read by shared analysis', () => {
  const files = {
    [globals]: ':root { --text-body: #444; }',
    [ui]: `export const View=()=> <span style={{color:'var(--text-body)'}}/>`,
    'apps/sim/app/(landing)/page.tsx': `throw Error('landing source must not be read')`,
    'apps/sim/app/(docs)/page.tsx': `throw Error('docs source must not be read')`,
    'apps/sim/app/design-studio/components/page.tsx': `throw Error('studio source must not be read')`,
    'apps/sim/lib/content/mdx.tsx': `throw Error('marketing renderer must not be read')`,
  }
  const base = source(files)
  const touched: string[] = []
  inspectSimplifications({
    ...base,
    read: (entry) => {
      touched.push(entry.path)
      if (productScope(entry.path) === 'exclude')
        throw new Error(`Excluded source read: ${entry.path}`)
      return files[entry.path as keyof typeof files]
    },
  })
  expect(touched.some((file) => productScope(file) === 'exclude')).toBe(false)
})

test('finite imported colour object is traced through computed lookup to a style sink', () => {
  const report = inspect({
    'apps/sim/components/status.ts': `export const STATUS_CONFIG = {
      pending: { color: '#f59e0b' }, cancelled: { color: '#f97316' }
    }`,
    [ui]: `import { STATUS_CONFIG } from './status'
      export function View({status}:{status:'pending'|'cancelled'}) {
        return <span style={{backgroundColor: STATUS_CONFIG[status].color}} />
      }`,
  })
  expect(
    report.colourAssignments.findings.some(
      (finding) => finding.file === ui && finding.value.includes('#f97316')
    )
  ).toBe(true)
  const unresolved = inspect({
    'apps/sim/components/status.ts': `export const STATUS_CONFIG={pending:{color:'var(--caution)'}}`,
    [ui]: `import {STATUS_CONFIG} from './status'; export const View=({status})=><span style={{color:STATUS_CONFIG[status].color}}/>`,
  })
  expect(
    unresolved.colourAssignments.unchecked.some((note) =>
      note.reason.includes('unresolved provenance')
    )
  ).toBe(true)
  expect(
    unresolved.colourAssignments.assignments.some(
      (assignment) => assignment.status === 'unresolved'
    )
  ).toBe(true)
})

test('simple helper colour returns are traced and runtime inputs remain unchecked', () => {
  const literal = inspect({
    'apps/sim/components/tones.ts': `export function tone(ok){return ok?'var(--caution)':'#f97316'}`,
    [ui]: `import {tone} from './tones'; export const View=({ok})=><span style={{color:tone(ok)}}/>`,
  })
  expect(
    literal.colourAssignments.findings.some((finding) => finding.value.includes('#f97316'))
  ).toBe(true)
  const runtime = inspect({
    [ui]: `function tone(user){return user.color}; export const View=({user})=><span style={{color:tone(user)}}/>`,
  })
  expect(runtime.colourAssignments.findings).toEqual([])
  expect(
    runtime.colourAssignments.unchecked.some((note) =>
      note.reason.includes('unresolved provenance')
    )
  ).toBe(true)
})

test('barrel imported ChipTextarea resolves to the central control', () => {
  const report = inspect({
    'packages/emcn/src/index.ts': `export { ChipTextarea } from './components/chip-textarea'`,
    'packages/emcn/src/components/chip-textarea.tsx': `export function ChipTextarea(props){return <textarea {...props}/>}`,
    [ui]: `import {ChipTextarea} from '@sim/emcn'; export const View=()=> <ChipTextarea aria-label='Notes'/>`,
  })
  expect(
    report.controls.records.some(
      (record) =>
        record.file === ui &&
        record.origin === 'emcn-component' &&
        record.evidence.some((target) => target.includes('ChipTextarea'))
    )
  ).toBe(true)
})

test('registered EMCN chrome catches local overrides while layout-only width remains local', () => {
  const report = inspect({
    [ui]: `import {Badge, Input, PopoverContent, Tooltip} from '@sim/emcn'
    export const View=()=> <><Badge className='bg-red-500'>A</Badge>
      <Input className='h-12 max-w-xs'/><PopoverContent className='p-8'/>
      <Tooltip.Content className='text-lg'>Help</Tooltip.Content></>`,
  })
  const overrides = report.review.findings.filter((finding) => finding.rule === 'component-chrome')
  expect(overrides.map((finding) => finding.value)).toEqual(
    expect.arrayContaining(['bg-red-500', 'h-12', 'p-8', 'text-lg'])
  )
  expect(overrides.some((finding) => finding.value === 'max-w-xs')).toBe(false)
  const barrel = inspect({
    'packages/emcn/src/index.ts': `export { Badge } from './components/badge/badge'`,
    'packages/emcn/src/components/badge/badge.tsx': `export function Badge({className,...props}:import('react').HTMLAttributes<HTMLSpanElement>){return <span {...props} className={cn('p-2',className)}/>} `,
    'apps/sim/components/barrel.ts': `export { Badge as StatusBadge } from '@sim/emcn'`,
    [ui]: `import {StatusBadge} from './barrel'; export const View=()=> <StatusBadge className='p-8'>A</StatusBadge>`,
  })
  expect(
    barrel.review.findings.some(
      (finding) => finding.value === 'p-8' && finding.rule === 'component-chrome'
    )
  ).toBe(true)
  const central = inspect({
    'packages/emcn/src/index.ts': `export { Input } from './components/input'`,
    'packages/emcn/src/components/input.tsx': `export function Input(props){return <input {...props}/>}`,
    'packages/emcn/src/components/composite.tsx': `import {Input} from '../../index'; export const Composite=()=> <Input className='p-8'/>`,
  })
  expect(central.review.findings.some((finding) => finding.file.startsWith('packages/emcn/'))).toBe(
    false
  )
})

test('finite literal branch and landing-only token cannot be approved by the other branch', () => {
  const report = inspect({
    [ui]: `export const View=({active})=><span style={{
    backgroundColor: active ? '#EAB308' : 'var(--color-yellow-500)'
  }} />`,
  })
  expect(
    report.colourAssignments.findings.some((finding) => finding.value.includes('#EAB308'))
  ).toBe(true)
  const landing = inspect({
    [ui]: `export const View=()=> <span style={{color:'var(--landing-text)'}}/>`,
  })
  expect(
    landing.colourAssignments.findings.some((finding) =>
      finding.reason.includes('Landing-only token')
    )
  ).toBe(true)
  const radius = inspect({
    [ui]: `export const View=()=> <span className='rounded-[var(--landing-radius)]' style={{borderRadius:'var(--landing-radius)'}}/>`,
    'apps/sim/components/example.css': '.product { border-radius: var(--landing-radius); }',
  })
  expect(radius.review.findings.filter((finding) => finding.rule === 'central-token')).toHaveLength(
    2
  )
})

test('Monaco theme palette is excluded while other product styling remains checked', () => {
  const report = inspect({
    [ui]: `
    const rules=[{token:'keyword',foreground:'33b4ff'}]
    monaco.editor.defineTheme('dark',{rules,colors:{'editor.background':'#1b1b1b'}})
    const html=\`<html><style>body { background: #000; }</style></html>\`
    new Blob([html],{type:'text/html'})
  `,
  })
  expect(report.review.findings.some((finding) => finding.value === '#1b1b1b')).toBe(false)
  expect(report.review.findings.some((finding) => finding.value === '#000')).toBe(true)
  expect(report.review.findings.some((item) => item.rule === 'syntax-colour')).toBe(false)
  const otherTheme = inspect({
    [ui]: `const rules=[{token:'keyword',foreground:'33b4ff'}];
      productTheme.editor.defineTheme('dark',{rules,colors:{'editor.background':'#1b1b1b'}})`,
  })
  expect(otherTheme.review.findings.some((finding) => finding.value === '#1b1b1b')).toBe(true)
  expect(otherTheme.review.findings.some((item) => item.rule === 'syntax-colour')).toBe(true)
  const dataOnly = inspect({
    [ui]: `const html='<style>body{color:#000}</style>';
    const payload={foreground:'#33b4ff'}; export const View=()=> <span>OK</span>`,
  })
  expect(dataOnly.review.findings).toEqual([])
})

test('mixed artwork inventory selects first-party glyphs without treating provider logos as product icons', () => {
  const report = inspect({
    'apps/sim/components/icons.tsx': `export function SearchIcon(){return <svg/>}
      export function ProviderLogo(){return <svg/>}`,
  })
  expect(
    report.review.findings.some(
      (item) => item.rule === 'mixed-product-artwork' && item.context === 'SearchIcon'
    )
  ).toBe(true)
  expect(report.review.findings.some((item) => item.context === 'ProviderLogo')).toBe(false)
})

test('complete EMCN recipes do not make native controls local-chrome advisories', () => {
  const report = inspect({
    [ui]: `import { chipVariants, chipGeometryClass, dropdownMenuRowClass, chipFilledFillTokens } from '@sim/emcn'
      export const ChipAction=()=> <button className={chipVariants()}>Chip action</button>
      export const GeometricAction=()=> <button className={chipGeometryClass}>Geometric action</button>
      export const MenuAction=()=> <button className={dropdownMenuRowClass}>Menu action</button>
      export const LayoutAction=()=> <button className={cn(chipVariants(), 'max-w-[220px]')}>Layout action</button>
      export const TonedAction=()=> <button className={cn(chipVariants(), 'text-[var(--text-muted)] text-small')}>Toned action</button>
      export const UnknownAction=({extra})=> <button className={cn(chipVariants(), extra)}>Unknown action</button>
      export const PartialRecipe=()=> <button className={chipFilledFillTokens}>Partial recipe</button>
      export const LocalAction=()=> <button className='rounded-md bg-red-500'>Local action</button>`,
    'packages/emcn/src/index.ts': `export const chipVariants=()=> 'rounded-sm bg-blue-500';
      export const chipGeometryClass='rounded-sm px-2';
      export const dropdownMenuRowClass='rounded-sm bg-blue-500';
      export const chipFilledFillTokens='bg-blue-500'`,
  })
  // The tiny fixture lacks the full EMCN export graph. Supply the already
  // resolved central recipe refs to exercise design finding classification itself.
  const controls = {
    ...report.controls,
    records: report.controls.records.map((record) => ({
      ...record,
      recipes: ['ChipAction', 'LayoutAction', 'TonedAction', 'UnknownAction'].includes(record.owner)
        ? ['packages/emcn/src/index.ts#chipVariants']
        : record.owner === 'GeometricAction'
          ? ['packages/emcn/src/index.ts#chipGeometryClass']
          : record.owner === 'MenuAction'
            ? ['packages/emcn/src/index.ts#dropdownMenuRowClass']
            : record.recipes,
    })),
  }
  const items = new ReviewCollector(source({ [globals]: ':root {}' })).finish(controls).findings
  const local = items.filter((item) => item.rule === 'local-control')
  expect(local.some((item) => item.value === 'button')).toBe(true)
  expect(local).toHaveLength(2)
  const overrides = items.filter((item) => item.rule === 'emcn-recipe-override')
  expect(overrides.map((item) => item.context).sort()).toEqual(['TonedAction', 'UnknownAction'])
  expect(overrides.find((item) => item.context === 'TonedAction')?.value).toContain(
    'text-[var(--text-muted)]'
  )
})

test('repeated layout alone is quiet while repeated chrome remains reviewable', () => {
  const report = inspect({
    [ui]: `export const LayoutA=()=> <div className='flex gap-2 items-center'/>
      export const LayoutB=()=> <div className='flex gap-2 items-center'/>
      export const LayoutC=()=> <div className='flex gap-2 items-center'/>
      export const ChromeA=()=> <div className='rounded-md border border-[var(--border)]'/>
      export const ChromeB=()=> <div className='rounded-md border border-[var(--border)]'/>
      export const ChromeC=()=> <div className='rounded-md border border-[var(--border)]'/>`,
  })
  const repeated = report.review.findings.filter((item) => item.rule === 'repeated-treatment')
  expect(repeated.some((item) => item.value === 'flex gap-2 items-center')).toBe(false)
  expect(repeated.some((item) => item.value.includes('rounded-md'))).toBe(true)
})

test('runtime CSS review distinguishes source-proven boundaries without approving unknown CSS', () => {
  const report = inspect({
    'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/text-editor.tsx': `
      const FIND_TOOLTIP_FIX_CSS = \`[data-find-tooltip-fix] .context-view { transform: translateY(56px); }\`
      export const Editor=()=> <style>{FIND_TOOLTIP_FIX_CSS}</style>`,
    'apps/sim/app/workspace/[workspaceId]/w/components/preview/components/preview-editor/preview-editor.tsx': `
      const READONLY_PREVIEW_STYLES = \`.readonly-preview [disabled] { opacity: 1 !important; }\`
      export const Preview=()=> <style>{READONLY_PREVIEW_STYLES}</style>`,
    [ui]: `export const View=({css})=> <style>{css}</style>`,
  })
  const kinds = report.review.findings.map((item) => item.rule)
  expect(kinds).toContain('runtime-style-editor-tooltip')
  expect(kinds).toContain('runtime-style-preview-disabled')
  expect(kinds).toContain('runtime-style')
  expect(
    report.review.unchecked.filter((note) =>
      note.reason.includes('computed style remains unchecked')
    )
  ).toHaveLength(3)
})

test('customer branding and shared preview cursor selectors have distinct review reasons', () => {
  const report = inspect({
    'apps/sim/ee/whitelabeling/components/branding-provider.tsx': `
      import { generateOrgThemeCSS } from '@/ee/whitelabeling/org-branding-utils'
      import { useMemo } from 'react'
      export const BrandingProvider=({effectiveOrgSettings})=>{
        const themeCSS=useMemo(()=>effectiveOrgSettings ? generateOrgThemeCSS(effectiveOrgSettings) : '',[effectiveOrgSettings])
        return <style>{themeCSS}</style>
      }`,
    'apps/sim/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-workflow.tsx': `
      export const PreviewWorkflow=({cursorStyle})=> <style>{\`.preview-mode .react-flow { cursor: \${cursorStyle}; }\`}</style>`,
  })
  expect(report.review.findings.map((item) => item.rule)).toEqual(
    expect.arrayContaining(['runtime-style-customer-brand', 'runtime-style-preview-cursor'])
  )
  expect(report.review.unchecked).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining('customer input') }),
      expect.objectContaining({ reason: expect.stringContaining('scope it to this preview') }),
    ])
  )
})

test('landing imports are an explicit boundary and a ledger never removes raw findings', () => {
  const report = inspect({
    [ui]: `import { LogoShell } from '@/app/(landing)/components/logo-shell'
    export const View=()=> <LogoShell><span style={{color:'#eee'}}/></LogoShell>`,
  })
  expect(
    report.review.unchecked.some((note) => note.reason.includes('excluded landing source'))
  ).toBe(true)
  const finding = report.colourAssignments.findings[0]
  expect(finding).toBeDefined()
  const decisions = matchReviews(
    {
      version: '1.0.0',
      entries: [
        {
          fingerprint: findingFingerprint(finding),
          status: 'retained-extra',
          rationale: 'Reviewed geometry',
          evidence: '/external/review',
        },
      ],
    },
    [finding],
    []
  )
  expect(decisions.matches).toHaveLength(1)
  expect(report.colourAssignments.findings).toContain(finding)
  const duplicate = matchReviews(
    {
      version: '1.0.0',
      entries: [
        {
          fingerprint: findingFingerprint(finding),
          status: 'retained-extra',
          rationale: 'Reviewed geometry',
          evidence: '/external/review',
        },
        {
          fingerprint: 'a'.repeat(64),
          status: 'designer-review',
          rationale: 'Needs designer review',
          evidence: '/external/review',
        },
      ],
    },
    [finding, finding],
    []
  )
  expect(duplicate.matches).toEqual([])
  expect(duplicate.ambiguous).toContain(findingFingerprint(finding))
  expect(duplicate.stale).toContain('a'.repeat(64))
})

test('syntax and extraction errors remain distinguishable', () => {
  const bad = extract('export const View=()=> <div className={', ui, false, {
    conformance: true,
    resolve: () => undefined,
  })
  expect(bad.unchecked.some((note) => note.reason.startsWith('Parser failure:'))).toBe(true)
  const valid = extract('export const View=()=> <div className={undefined} />', ui, false, {
    conformance: true,
    resolve: () => undefined,
  })
  expect(valid.unchecked.some((note) => /^(?:Parser|Extraction) failure/.test(note.reason))).toBe(
    false
  )
})
