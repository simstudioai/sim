import { expect, it } from 'vitest'
import { allChanges, compareFiles, config } from '#design-diff/tests/helpers'

const consumer = 'apps/sim/button.tsx'
const token = 'apps/sim/token.ts'

it('resolves constants, object properties and template strings through aliases and re-exports', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const design = { padding: 4, colour: "red" } as const',
      'apps/sim/barrel.ts': 'export { design as theme } from "./token"',
      [consumer]: `import {theme} from "@/barrel"; export const Button=()=> <button style={{padding:theme.padding, color:\`\${theme.colour}\`}}>Go</button>`,
    },
    { [token]: 'export const design = { padding: 8, colour: "red" } as const' }
  )
  expect(report.flagged).toBe(true)
  expect(
    allChanges(report)
      .filter((finding) => finding.after?.location.file === consumer)
      .map((finding) => finding.category)
  ).toEqual(['dimensions'])
  expect(allChanges(report)[0].dependencies).toContain(token)
})

it('reads workspace package exports without loading the package', async () => {
  const token = 'packages/design/src/theme.ts'
  const report = await compareFiles(
    {
      'packages/design/package.json':
        '{"name":"@sim/design","exports":{"./theme":"./src/theme.ts"}}',
      [token]: 'export const padding = 4',
      [consumer]:
        'import {padding} from "@sim/design/theme"; export const A=()=> <div style={{padding}}/>',
    },
    { [token]: 'export const padding = 8' }
  )
  expect(
    allChanges(report).some(
      (finding) => finding.after?.location.file === consumer && finding.decision === 'flag'
    )
  ).toBe(true)
})

it('follows dependencies from both revisions when an import is replaced', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const padding=4',
      'apps/sim/other.ts': 'export const padding=8',
      [consumer]: 'import {padding} from "./token"; export const A=()=> <div style={{padding}}/>',
    },
    { [consumer]: 'import {padding} from "./other"; export const A=()=> <div style={{padding}}/>' }
  )
  expect(report.flagged).toBe(true)
  expect(allChanges(report)[0].dependencies).toEqual(
    expect.arrayContaining([token, 'apps/sim/other.ts'])
  )
})

it('bounds cycles without notifying on unresolved effects', async () => {
  const report = await compareFiles(
    {
      [token]: 'import { padding as other } from "./other"; export const padding=other',
      'apps/sim/other.ts': 'import { padding as other } from "./token"; export const padding=other',
      [consumer]: 'import {padding} from "./token"; export const A=()=> <div style={{padding}}/>',
    },
    { [token]: 'import { padding as other } from "./other"; export const padding=other+1' }
  )
  expect(report.flagged).toBe(false)
  expect(allChanges(report).some((finding) => finding.decision === 'flag')).toBe(false)
})

it('retains conditional branches and CVA variants/defaults', async () => {
  const source = (size: string) =>
    `import {cva} from 'class-variance-authority'; const button=cva('rounded-md',{variants:{size:{sm:'p-2',lg:'p-4'}},defaultVariants:{size:'${size}'}}); export const A=()=> <div className={button({size:enabled?'lg':'sm'})}/>`
  const report = await compareFiles(
    { [consumer]: source('sm') },
    { [consumer]: source('lg') },
    { ...config, themes: [] }
  )
  expect(report.flagged).toBe(true)
  expect(JSON.stringify(allChanges(report))).toContain('defaultVariants')
})

it('evaluates static CVA defaults and compound variants at an unchanged consumer', async () => {
  const source = (size: string) =>
    `import {cva} from 'class-variance-authority'; const button=cva('rounded-md',{variants:{size:{sm:'p-2',lg:'p-4'}},defaultVariants:{size:'${size}'},compoundVariants:[{size:'lg',class:'font-bold'}]}); export const A=()=> <div className={button()}/>`
  const report = await compareFiles(
    { [consumer]: source('sm') },
    { [consumer]: source('lg') },
    { ...config, themes: [] }
  )
  const finding = allChanges(report).find((finding) => finding.after?.property === 'className')
  expect(finding?.decision).toBe('flag')
  expect(JSON.stringify(finding?.after?.value)).toContain('rounded-md p-4 font-bold')
})

it('does not collapse class composition order', async () => {
  const source = (classes: string) =>
    `import {clsx} from 'clsx'; export const A=()=> <div className={clsx(${classes})}/>`
  const report = await compareFiles(
    { [consumer]: source('"p-2","p-4"') },
    { [consumer]: source('"p-4","p-2"') },
    { ...config, themes: [] }
  )
  expect(report.flagged).toBe(true)
})

it.each([
  ['bg-[#383838]', 'bg-[#E11D48]', 'colour'],
  ['p-0', 'p-2', 'dimensions'],
])('resolves imported %s through the EMCN root cn export', async (before, after, category) => {
  const report = await compareFiles(
    {
      [token]: `export const classes = '${before}'`,
      [consumer]:
        'import {cn} from "@sim/emcn"; import {classes} from "./token"; export const A=()=> <button className={cn("rounded-full", classes)}/>',
    },
    { [token]: `export const classes = '${after}'` },
    { ...config, themes: [] }
  )
  const finding = allChanges(report).find((finding) => finding.after?.location.file === consumer)
  expect(finding?.decision).toBe('flag')
  expect(finding?.category).toBe(category)
  expect(finding?.limitations).toEqual([])
  expect(finding?.dependencies).toContain(token)
})

it('exempts unsupported class helpers without executing them', async () => {
  const source = (value: string) =>
    `import {clsx} from 'untrusted-helper'; export const A=()=> <div className={clsx('${value}')}/>`
  const report = await compareFiles(
    { [consumer]: source('p-2') },
    { [consumer]: source('p-4') },
    { ...config, themes: [] }
  )
  expect(allChanges(report).some((finding) => finding.decision === 'flag')).toBe(false)
})

it('exempts changed documentation expressions', async () => {
  const document = 'apps/docs/content/a.mdx'
  const report = await compareFiles(
    {
      'apps/docs/token.ts': 'export const title = "First"',
      [document]: 'import {title} from "../token"\n\n# Hello\n\n{title}',
    },
    { 'apps/docs/token.ts': 'export const title = "Second"' }
  )
  expect(allChanges(report).some((finding) => finding.after?.location.file === document)).toBe(
    false
  )
})

it('reviews a token change behind an unexecuted helper through transitive imports', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const padding=4',
      'apps/sim/helper.ts':
        'import {padding} from "./token"; export function getPadding(){return padding}',
      [consumer]:
        'import {getPadding} from "./helper"; export const A=()=> <div style={{padding:getPadding()}}/>',
    },
    { [token]: 'export const padding=8' }
  )
  expect(
    allChanges(report).some(
      (finding) => finding.after?.location.file === consumer && finding.decision === 'flag'
    )
  ).toBe(true)
})
