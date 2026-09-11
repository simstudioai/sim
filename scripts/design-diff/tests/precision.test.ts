import { expect, it } from 'vitest'
import { allChanges, compareFiles, config } from '#design-diff/tests/helpers'

const settings = { ...config, themes: [] }
const view = 'apps/sim/page.tsx'
const data = 'apps/sim/data.ts'

it.each([
  [
    'nonempty accumulator',
    'Object.entries(input).reduce((acc,[key,value])=>({...acc,[key]:value}),{extra:1})',
  ],
  [
    'accumulator read',
    'Object.entries(input).reduce((acc,[key,value])=>({...acc,[key]:acc.previous}),{})',
  ],
  ['changed key', 'Object.entries(input).reduce((acc,[key,value])=>({...acc,[value]:value}),{})'],
])('does not erase a record-map change with %s', async (_name, expression) => {
  const source = (value: string) =>
    `export function Page({input}){return <div data-record={${value}}/>}`
  const report = await compareFiles(
    { [view]: source(expression) },
    { [view]: source('Object.fromEntries(Object.entries(input).map(([key,value])=>[key,value]))') },
    settings
  )
  expect(report.flagged).toBe(true)
})

it.each([
  [
    'SQL validation',
    'import {sql} from "drizzle-orm";export const query=sql`x = 1`',
    'import {sql} from "drizzle-orm";export const query=sql`x = 2`',
  ],
  [
    'telemetry',
    'import {trace} from "@opentelemetry/api";const span=trace.getTracer("a").startSpan("x");span.setAttribute("warm",false)',
    'import {trace} from "@opentelemetry/api";const span=trace.getTracer("a").startSpan("x");span.setAttribute("warm",true)',
  ],
])('does not classify %s as standalone rendering', async (_name, before, after) => {
  const report = await compareFiles(
    {
      [data]: before,
      [view]:
        'import {query} from "./data";export const Page=()=> <button className={unknown()}>Go</button>',
    },
    { [data]: after },
    settings
  )
  expect(report.flagged).toBe(false)
})

it('isolates nested properties and unrelated imported environment settings', async () => {
  const source = (count: number) =>
    `import {createEnv} from '@t3-oss/env-nextjs';export const env=createEnv({server:{BATCH:rule(${count})},client:{NEXT_PUBLIC_DISABLED:rule(false)}});export const design={button:{colour:'red'},count:${count}}`
  const report = await compareFiles(
    {
      [data]: source(4),
      [view]:
        'import {env,design} from "./data";export const Page=()=> <button disabled={env.NEXT_PUBLIC_DISABLED} style={{color:design.button.colour}}/>',
    },
    { [data]: source(8) },
    settings
  )
  expect(report.flagged).toBe(false)
})

it.each([
  [
    'unused props',
    'export function Page({colour="red",unused=false}){return <button style={{color:colour}}/>}',
    'export function Page({colour="red"}){return <button style={{color:colour}}/>}',
  ],
  [
    'constant hoisting',
    'export function Page(){const padding={top:4};return <button style={{paddingTop:padding.top}}/>}',
    'const PADDING={top:4};export function Page(){return <button style={{paddingTop:PADDING.top}}/>}',
  ],
  [
    'local renames',
    'export function Page(){const colour=unknown();return <button style={{color:colour}}/>}',
    'export function Page(){const paint=unknown();return <button style={{color:paint}}/>}',
  ],
])('preserves equivalent %s', async (_name, before, after) => {
  expect((await compareFiles({ [view]: before }, { [view]: after }, settings)).flagged).toBe(false)
})

it('traces a helper return through an alias and excludes its unrelated export', async () => {
  const source = (n: number, colour: string) =>
    `export const options={button:{colour:'${colour}'},other:${n}};export function paint(){return options.button.colour};export const unused=${n}`
  const files = {
    [data]: source(4, 'red'),
    [view]:
      'import {paint as colour} from "./data";export const Page=()=> <button style={{color:colour()}}/>',
  }
  expect((await compareFiles(files, { [data]: source(8, 'red') }, settings)).flagged).toBe(false)
  const report = await compareFiles(files, { [data]: source(4, 'blue') }, settings)
  expect(report.flagged).toBe(true)
  expect(allChanges(report).some((change) => change.after?.location.file === view)).toBe(true)
})

it('traces a changed hidden-tool set to a UI condition', async () => {
  const source = (tool: string) =>
    `const hidden=new Set(['${tool}']);export function visible(name){return !hidden.has(name)}`
  const report = await compareFiles(
    {
      [data]: source('read'),
      [view]:
        'import {visible} from "./data";export function Page({tool}){return visible(tool) && <span>Tool</span>}',
    },
    { [data]: source('write') },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(allChanges(report).some((change) => change.after?.location.file === view)).toBe(true)
})

it('still detects actual DOM attribute and canvas appearance operations', async () => {
  for (const source of [
    (colour: string) =>
      `const button=document.createElement('button');button.setAttribute('class','${colour}')`,
    (colour: string) =>
      `function draw(canvas: HTMLCanvasElement){const ctx=canvas.getContext('2d');ctx.fillStyle='${colour}';ctx.fillRect(0,0,20,20)}`,
  ])
    expect(
      (await compareFiles({ [data]: source('red') }, { [data]: source('blue') }, settings)).flagged
    ).toBe(true)
})

it('does not propagate dead re-exports into unrelated unresolved JSX', async () => {
  const report = await compareFiles(
    {
      [data]: 'export const dead=4;export const live=8',
      'apps/sim/index.ts': 'export {dead,live} from "./data"',
      [view]:
        'import {live} from "./index";export const Page=()=> <button style={{width:unknown(live)}}/>',
    },
    { 'apps/sim/index.ts': 'export {live} from "./data"' },
    settings
  )
  expect(report.flagged).toBe(false)
})

it('keeps a destructured local property independent of removed siblings and names', async () => {
  const before =
    'const options={colour:"red",unused:4};export function Page(){const {colour,unused}=options;return <button style={{color:colour}}/>}'
  const after =
    'const options={colour:"red",unused:4};export function Page(){const {colour:paint}=options;return <button style={{color:paint}}/>}'
  expect((await compareFiles({ [view]: before }, { [view]: after }, settings)).flagged).toBe(false)
})

it('does not re-fingerprint unused component parameters at an imported consumer', async () => {
  const component = (unused: string) =>
    `export function Button({colour="red"${unused}}){return <button style={{color:colour}}/>}`
  const report = await compareFiles(
    {
      [data]: component(',unused=false'),
      [view]:
        'import {Button} from "./data";export const Page=()=> <div>{ready && <Button/>}</div>',
    },
    { [data]: component('') },
    settings
  )
  expect(report.flagged).toBe(false)
})

it('recognizes an aliased class helper by its imported binding', async () => {
  const source = (colour: string) =>
    `import {clsx as classes} from "clsx";export const Page=()=> <button className={classes("${colour}")}/>`
  const report = await compareFiles(
    { [view]: source('text-red-500') },
    { [view]: source('text-blue-500') },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(allChanges(report)[0].category).toBe('colour')
})

it('retains unresolved WebGL operations in a known canvas context', async () => {
  const source = (shader: string) =>
    `function draw(canvas:HTMLCanvasElement){const gl=canvas.getContext('webgl');gl.shaderSource(shader,'${shader}')}`
  expect(
    (await compareFiles({ [data]: source('before') }, { [data]: source('after') }, settings))
      .flagged
  ).toBe(true)
})

it('preserves helper switch selection conditions', async () => {
  const source = (mode: string) =>
    `export function colour(mode){switch(mode){case '${mode}':return 'red';default:return 'blue'}}`
  const report = await compareFiles(
    {
      [data]: source('a'),
      [view]:
        'import {colour} from "./data";export const Page=()=> <span style={{color:colour(mode)}}/>',
    },
    { [data]: source('b') },
    settings
  )
  expect(report.flagged).toBe(true)
})

it.each([1, 24])(
  'preserves the audited record-map refactor at resolution depth %s',
  async (resolutionDepth) => {
    const before =
      'export const copy=(blocks)=>Object.entries(blocks).reduce((acc,[id,block])=>({...acc,[id]:{...block,value:structuredClone(block.value)}}),{})'
    const after =
      'export const copy=(blocks)=>Object.fromEntries(Object.entries(blocks).map(([id,block])=>[id,{...block,value:structuredClone(block.value)}]))'
    const report = await compareFiles(
      {
        [data]: before,
        [view]: 'import {copy} from "./data";export const Page=()=> <Panel data={copy(blocks)}/>',
      },
      { [data]: after },
      { ...settings, limits: { ...settings.limits, resolutionDepth } }
    )
    expect(report.flagged).toBe(false)
  }
)

it('keeps selected environment evidence narrow after exhausting expression depth', async () => {
  const source = (size: number) =>
    `import {createEnv} from '@t3-oss/env-nextjs';export const env=createEnv({server:{GITHUB_TOKEN:rule('same'),BATCH:rule(${size})}})`
  const report = await compareFiles(
    {
      [data]: source(4),
      [view]:
        'import {env} from "./data";export const Page=()=> <Panel data={unknown(unknown(unknown(env.GITHUB_TOKEN)))}/>',
    },
    { [data]: source(8) },
    { ...settings, limits: { ...settings.limits, resolutionDepth: 2 } }
  )
  expect(report.flagged).toBe(false)
})

it('projects configured capability environment fields and retains helper changes', async () => {
  const adapter = settings.environmentAdapters![0]
  const configured = {
    ...settings,
    aliases: [
      ...settings.aliases,
      { from: 'apps/sim/', prefix: '@capability/', target: 'apps/sim/lib/core/config/' },
    ],
  }
  const environment = (batch: number, email: boolean) =>
    `import {createEnv} from '@t3-oss/env-nextjs';export const env=createEnv({server:{BATCH:rule(${batch}),EMAIL:rule(${email})}})`
  const files = {
    [adapter.environmentModule]: environment(4, true),
    [adapter.module]: `import {env} from './env';import {wireFallback} from '@capability/env-capabilities';export function wireServerFallback(options){return wireFallback({...options,values:env})}`,
    [adapter.implementationModule]:
      'export function wireFallback({values,definition}){return {providers:[]}}',
    [data]: `import {wireServerFallback} from '@/lib/core/config/env-capabilities.server';const CAPABILITY=defineCapability({providers:[{activation:{keys:['EMAIL']}}]});export const providers=wireServerFallback({definition:CAPABILITY,factories:{}}).providers`,
    [view]:
      'import {providers} from "./data";export const Page=()=> <div hidden={providers.length===0}/>',
  }
  expect(
    (await compareFiles(files, { [adapter.environmentModule]: environment(8, true) }, configured))
      .flagged
  ).toBe(false)
  expect(
    (await compareFiles(files, { [adapter.environmentModule]: environment(4, false) }, configured))
      .flagged
  ).toBe(true)
  expect(
    (
      await compareFiles(
        files,
        {
          [adapter.implementationModule]:
            'export function wireFallback({values,definition}){return {providers:[1]}}',
        },
        configured
      )
    ).flagged
  ).toBe(true)
})

it('leaves type queries over literal constants erased and parseable', async () => {
  const source = (kind: string) =>
    `const KINDS=['one','two'] as const;type Kind = typeof KINDS[number];export const Page=()=> <span>${kind}</span>`
  const report = await compareFiles({ [view]: source('a') }, { [view]: source('b') }, settings)
  expect(report.flagged).toBe(true)
  expect(
    report.findings
      .flatMap((finding) => finding.limitations)
      .some((reason) => /parser|extraction failed/i.test(reason))
  ).toBe(false)
})

it('preserves value/type names shared by generated schema declarations', async () => {
  const source = (text: string) =>
    `const Kind={ONE:1};type Kind=typeof Kind;export const Page=()=> <div>${text}</div>`
  const report = await compareFiles({ [view]: source('a') }, { [view]: source('b') }, settings)
  expect(report.flagged).toBe(true)
  expect(
    report.findings
      .flatMap((finding) => finding.limitations)
      .some((reason) => /parser|extraction failed/i.test(reason))
  ).toBe(false)
})

it.each([
  (colour: string) =>
    `export function colours(){const values=[];values.push('${colour}');return values}`,
  (colour: string) =>
    `export function colours(){const values={colour:'red'};values.colour='${colour}';return values.colour}`,
])('retains writes to const collections feeding rendering', async (source) => {
  const report = await compareFiles(
    {
      [data]: source('red'),
      [view]: 'import {colours} from "./data";export const Page=()=> <Panel colours={colours()}/>',
    },
    { [data]: source('blue') },
    settings
  )
  expect(report.flagged).toBe(true)
})

it('retains conditions around collection writes', async () => {
  const source = (enabled: boolean) =>
    `export function colours(){const values=[];if(${enabled})values.push('red');return values}`
  const report = await compareFiles(
    {
      [data]: source(true),
      [view]: 'import {colours} from "./data";export const Page=()=> <Panel colours={colours()}/>',
    },
    { [data]: source(false) },
    settings
  )
  expect(report.flagged).toBe(true)
})

it('isolates unrelated mutable object fields such as telemetry warmup state', async () => {
  const source = (warm: boolean) =>
    `const state={client:null,warmup:false};state.client=connect();state.warmup=${warm};export function client(){return state.client}`
  const report = await compareFiles(
    {
      [data]: source(false),
      [view]: 'import {client} from "./data";export const Page=()=> <Panel client={client()}/>',
    },
    { [data]: source(true) },
    settings
  )
  expect(report.flagged).toBe(false)
})
