import { expect, it } from 'vitest'
import { GitReader } from '#design-diff/git'
import { SourceTree } from '#design-diff/source'
import { allChanges, compareFiles, config, FixtureRepo } from '#design-diff/tests/helpers'

const settings = { ...config, themes: [] }
const token = 'apps/sim/token.ts'
const other = 'apps/sim/other.ts'
const index = 'apps/sim/index.ts'
const consumer = 'apps/sim/page.tsx'
const unrelated = 'apps/sim/unrelated.tsx'

it.each([
  [
    'named alias',
    'export {colour as paint} from "./token"',
    'import {paint as colour} from "./index"',
  ],
  ['star', 'export * from "./token";export * from "./other"', 'import {colour} from "./index"'],
  [
    'import then export',
    'import {colour} from "./token";export {colour}',
    'import {colour} from "./index"',
  ],
  ['default alias', 'export {colour as default} from "./token"', 'import colour from "./index"'],
  [
    'namespace member',
    'export * from "./token";export * from "./other"',
    'import * as palette from "./index";const colour=palette.colour',
  ],
])('follows %s exports without implicating an unrelated import', async (_name, barrel, imports) => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red"',
      [other]: 'export const size=4',
      [index]: barrel,
      [consumer]: `${imports};export const A=()=> <div style={{color:colour}}/>`,
      [unrelated]:
        'import {size} from "./other";export const A=()=> <div className={unknown(size)}/>',
    },
    { [token]: 'export const colour="blue"' },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings).toHaveLength(1)
  expect(report.findings[0].consumers).toContain(consumer)
  expect(report.findings[0].consumers).not.toContain(unrelated)
  expect(allChanges(report).some((change) => change.after?.location.file === consumer)).toBe(true)
})

it.each([
  'import {Button} from "./index";export const A=()=> <Button/>',
  'import * as UI from "./index";export const A=()=> <UI.Button/>',
])('detects a component re-export redirected to a different implementation: %s', async (view) => {
  const report = await compareFiles(
    {
      [token]: 'export const Button=()=> <button/>',
      [other]: 'export const Button=()=> <a/>',
      [index]: 'export {Button} from "./token"',
      [consumer]: view,
    },
    { [index]: 'export {Button} from "./other"' },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings[0].source.after?.file).toBe(index)
  expect(report.findings[0].example?.basis).toBe('changed-definition')
})

it('does not implicate the other named export when a pure barrel mapping changes', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red"',
      [other]: 'export const size=4',
      [index]: 'export {colour} from "./token";export {size} from "./other"',
      [consumer]:
        'import {size} from "./index";export const A=()=> <div className={unknown(size)}/>',
    },
    { [index]: 'export {colour as paint} from "./token";export {size} from "./other"' },
    settings
  )
  expect(report.flagged).toBe(false)
})

it('retains conservative propagation for computed namespaces without claiming exact usages', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red"',
      [index]: 'export * from "./token"',
      [consumer]:
        'import * as palette from "./index";export const A=()=> <div style={{color:palette[key]}}/>',
    },
    { [token]: 'export const colour="blue"' },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings[0].impact.after.referenceCount).toBe(0)
  expect(report.findings[0].limitations.join(' ')).toContain('Import usage is unresolved')
})

it('does not turn an unused cyclic re-export into presentation evidence', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red"',
      [index]: 'export * from "./other";export * from "./token"',
      [other]: 'export * from "./index"',
      [consumer]: 'import "./index";export const A=()=> <div className={unknown()}/>',
    },
    { [token]: 'export const colour="blue"' },
    settings
  )
  expect(report.flagged).toBe(false)
  expect(report.findings).toEqual([])
})

it('does not count erased type references or JSX closing tags as usages', async () => {
  const report = await compareFiles(
    {
      [token]:
        'export const Button=()=> <button style={{color:"red"}}/>;export interface Props {x:string}',
      [consumer]:
        'import {Button,type Props} from "./token";export const A=(props:Props)=> <Button></Button>',
    },
    {
      [token]:
        'export const Button=()=> <button style={{color:"blue"}}/>;export interface Props {x:string}',
    },
    settings
  )
  expect(report.findings[0].impact.after.referenceCount).toBe(1)
  expect(report.findings[0].impact.after.references[0].kind).toBe('jsx')
})

it('isolates changed exports within a module and excludes unrelated bindings from usage counts', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red";export const size=4',
      [consumer]:
        'import {colour} from "./token";export const A=()=> <div style={{color:colour}}/>',
      [unrelated]:
        'import {size} from "./token";export const B=()=> <div className={unknown(size)}/>',
    },
    { [token]: 'export const colour="blue";export const size=4' },
    settings
  )
  expect(report.findings).toHaveLength(1)
  expect(report.findings[0].impact.after.referenceCount).toBe(1)
  expect(report.findings[0].consumers).toEqual([consumer])
  expect(JSON.stringify(report.findings)).not.toContain(unrelated)
})

it('does not flag an unused changed export through an unrelated unresolved consumer', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const unused="red";export const size=4',
      [consumer]:
        'import {size} from "./token";export const A=()=> <div className={unknown(size)}/>',
    },
    { [token]: 'export const unused="blue";export const size=4' },
    settings
  )
  expect(report.flagged).toBe(false)
  expect(report.findings).toEqual([])
})

it('follows local binding dependencies from a shared variant into the exported component', async () => {
  const view = (radius: number) =>
    `const style={borderRadius:${radius}};export function Button(){return <button style={style}/>}export const Icon=()=> <svg/>`
  const report = await compareFiles(
    {
      [token]: view(5),
      [index]: 'export {Button,Icon} from "./token"',
      [consumer]: 'import {Button} from "./index";export const A=()=> <Button disabled={busy}/>',
      [unrelated]: 'import {Icon} from "./index";export const B=()=> <Icon className={unknown()}/>',
    },
    { [token]: view(0) },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings[0].consumers).toEqual([consumer])
  expect(report.findings[0].impact.after.references.map((reference) => reference.symbol)).toEqual([
    'Button',
  ])
})

it('flags added stylesheet side effects through a previously pure re-export', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const Button=()=> <button/>',
      [index]: 'export {Button} from "./token"',
      'apps/sim/global.css': 'button { border-radius:0 }',
      [consumer]: 'import {Button} from "./index";export const A=()=> <Button/>',
    },
    { [index]: 'import "./global.css";export {Button} from "./token"' },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings[0].source.after?.file).toBe(index)
  expect(report.findings[0].limitations).toContain('Imported module effects are not executed')
})

it('falls back conservatively when export resolution exhausts its budget', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red"',
      [index]: 'export * from "./other"',
      [other]: 'export * from "./token"',
      [consumer]:
        'import {colour} from "./index";export const A=()=> <div style={{color:colour}}/>',
    },
    { [token]: 'export const colour="blue"' },
    { ...settings, limits: { ...settings.limits, resolutionSteps: 1 } }
  )
  expect(report.flagged).toBe(true)
  expect(report.findings[0].impact.after.referenceCount).toBe(0)
  expect(report.findings[0].limitations.join(' ')).toContain('unresolved')
})

it('resolves a leaf export whose public name differs from its local binding', async () => {
  const report = await compareFiles(
    {
      [token]: 'const internal="red";export {internal as colour}',
      [index]: 'export * from "./token"',
      [consumer]:
        'import {colour} from "./index";export const A=()=> <div style={{color:colour}}/>',
    },
    { [token]: 'const internal="blue";export {internal as colour}' },
    settings
  )
  const evidence = report.findings[0].example?.change
  expect(evidence?.before?.value).toBe('red')
  expect(evidence?.after?.value).toBe('blue')
  expect(report.findings[0].impact.after.references[0].symbol).toBe('internal')
})

it('flags added stylesheet imports even when a barrel exports only resolved values', async () => {
  const report = await compareFiles(
    {
      [token]: 'export const colour="red"',
      [index]: 'export {colour} from "./token"',
      'apps/sim/global.css': 'button { border-radius:0 }',
      [consumer]:
        'import {colour} from "./index";export const A=()=> <button style={{color:colour}}/>',
    },
    { [index]: 'import "./global.css";export {colour} from "./token"' },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings[0].source.after?.file).toBe(index)
  expect(report.findings[0].category).toBe('infrastructure')
})

it('narrows candidate propagation at every helper hop, including uncertain namespace edges', () => {
  const repo = new FixtureRepo()
  try {
    const base = repo.commit({
      [token]: 'export const colour="red"',
      [other]:
        'import {colour} from "./token";export const related=()=>colour;export const unrelated=()=>4',
      [index]: 'export * from "./other"',
      [consumer]:
        'import * as values from "./index";export const Page=()=> <div style={{color:values.related()}}/>',
      [unrelated]:
        'import {unrelated} from "./other";export const Other=()=> <div style={{padding:unrelated()}}/>',
    })
    const head = repo.commit({ [token]: 'export const colour="blue"' })
    const reader = new GitReader(repo.cwd)
    const before = new SourceTree(reader, base, settings)
    const after = new SourceTree(reader, head, settings)
    before.buildGraph()
    after.buildGraph()
    const affected = before.graph.causes(new Set([token]), after.graph)
    expect(affected.has(consumer)).toBe(true)
    expect(affected.has(unrelated)).toBe(false)
  } finally {
    repo.close()
  }
})

it('widens converging dependency paths and retains module-effect uncertainty', async () => {
  const files = {
    [token]: 'export const colour="red"',
    [other]:
      'import {colour} from "./token";export const first=()=>colour;export const second=()=>colour',
    [index]:
      'import {first,second} from "./other";export const a=()=>first();export const b=()=>second()',
    [consumer]: 'import {b} from "./index";export const Page=()=> <div style={{color:b()}}/>',
  }
  expect(
    (await compareFiles(files, { [token]: 'export const colour="blue"' }, settings)).flagged
  ).toBe(true)
  expect(
    (
      await compareFiles(
        {
          ...files,
          [other]:
            'import {colour} from "./token";document.body.style.color=colour;export const first=()=>1;export const second=()=>2',
        },
        { [token]: 'export const colour="blue"' },
        settings
      )
    ).flagged
  ).toBe(true)
})

it.each(['first', 'second'])(
  'preserves every top-level destructured binding: %s',
  async (selected) => {
    const files = {
      [token]: 'export const colour="red"',
      [other]:
        'import {colour} from "./token";export const {first,second}={first:colour,second:colour}',
      [consumer]: `import {${selected} as colour} from './other';export const Page=()=> <div style={{color:colour}}/>`,
    }
    expect(
      (await compareFiles(files, { [token]: 'export const colour="blue"' }, settings)).flagged
    ).toBe(true)
  }
)
