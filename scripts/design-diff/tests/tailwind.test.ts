import { expect, it } from 'vitest'
import { compareFiles, config } from '#design-diff/tests/helpers'

const file = 'apps/sim/button.tsx'
const theme = 'apps/sim/app/_styles/globals.css'

it('normalizes pinned core utilities and per-app theme definitions', async () => {
  const report = await compareFiles(
    {
      [theme]: '@theme {--spacing: 4px;--color-brand:red}',
      [file]: 'export const A=()=> <div className="p-2 bg-brand"/>',
    },
    { [file]: 'export const A=()=> <div className="p-4 bg-brand"/>' }
  )
  const finding = report.findings.find((finding) => finding.after?.location.file === file)
  expect(finding?.decision).toBe('flag')
  expect(finding?.category).toBe('dimensions')
  expect(JSON.stringify(finding?.after?.value)).toContain('padding')
  expect(JSON.stringify(finding?.after?.value)).toContain('--color-brand')
})

it('reviews unsupported custom utilities', async () => {
  const report = await compareFiles(
    { [file]: 'export const A=()=> <div className="p-2"/>' },
    { [file]: 'export const A=()=> <div className="custom-plugin-button"/>' },
    { ...config, themes: [] }
  )
  expect(report.findings[0].decision).toBe('review')
  expect(report.findings[0].limitations.join(' ')).toContain('Unsupported utility')
})

it('preserves dark/responsive/state variants', async () => {
  const report = await compareFiles(
    { [file]: 'export const A=()=> <div className="hover:p-2 md:p-4"/>' },
    { [file]: 'export const A=()=> <div className="hover:p-4 md:p-4"/>' },
    { ...config, themes: [] }
  )
  expect(report.flagged).toBe(true)
  expect(JSON.stringify(report.findings)).toContain('hover')
})

it('preserves statement boundaries between selector and block custom variants', async () => {
  const report = await compareFiles(
    {
      [theme]: `
        @custom-variant dark (&:where(.dark, .dark *):not(:where(.light, .light *)));
        @custom-variant hover (&:hover);
        @custom-variant hover-hover {
          @media (hover: hover) and (pointer: fine) { &:hover { @slot; } }
        }
        @theme { --color-brand: #383838; }
      `,
      [file]: 'export const A=()=> <div className="dark:bg-brand hover:bg-brand hover-hover:p-2"/>',
    },
    {
      [file]: 'export const A=()=> <div className="dark:bg-brand hover:bg-brand hover-hover:p-4"/>',
    }
  )
  const finding = report.findings.find((finding) => finding.after?.location.file === file)
  expect(finding?.decision).toBe('flag')
  expect(finding?.category).toBe('dimensions')
  expect(finding?.limitations).toEqual([])
  expect(JSON.stringify(finding?.after?.value)).toContain('(pointer: fine)')
})

it('flags unchanged consumers of changed global theme variables', async () => {
  const report = await compareFiles(
    {
      [theme]: '@theme inline {--color-brand:var(--brand)} :root {--brand:red}',
      [file]: 'export const A=()=> <div className="bg-brand"/>',
    },
    { [theme]: '@theme inline {--color-brand:var(--brand)} :root {--brand:blue}' }
  )
  expect(report.findings.some((finding) => finding.after?.location.file === file)).toBe(true)
})

it('resolves CSS variable evidence in unchanged inline styles', async () => {
  const report = await compareFiles(
    {
      [theme]: ':root {--brand:red}',
      [file]: 'export const A=()=> <div style={{color:"var(--brand)"}}/>',
    },
    { [theme]: ':root {--brand:blue}' }
  )
  expect(report.findings.some((finding) => finding.after?.location.file === file)).toBe(true)
})

it('applies the trusted cn merge convention without discarding input order', async () => {
  const source = (classes: string) =>
    `import {cn} from '@sim/emcn/lib/cn'; export const A=()=> <div className={cn('${classes}')}/>`
  const report = await compareFiles(
    { [file]: source('p-2 p-4') },
    { [file]: source('p-4 p-2') },
    { ...config, themes: [] }
  )
  expect(report.flagged).toBe(true)
  expect(JSON.stringify(report.findings)).toContain('inputOrder')
})
