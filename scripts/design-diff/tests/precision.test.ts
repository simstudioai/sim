import { expect, it } from 'vitest'
import { semanticSource } from '#design-diff/ast'
import { allChanges, compareFiles, config } from '#design-diff/tests/helpers'

const settings = { ...config, themes: [] }
const view = 'apps/sim/page.tsx'
const data = 'apps/sim/data.ts'

it('does not trace type-only factory inputs through opaque helpers', async () => {
  const source = (count: number) => `export const backend={batch:${count}}`
  const files = {
    [data]: source(4),
    'apps/sim/client.ts':
      'import type {backend} from "./data";export const client=createClient<typeof backend>({name:"same"})',
    [view]:
      'import {client} from "./client";export const Page=()=> <span>{client.session()}</span>',
  }
  expect((await compareFiles(files, { [data]: source(8) }, settings)).flagged).toBe(false)
})

it('ignores resolved event-only custom props while retaining rendered uses', async () => {
  const component = (visible: boolean) => `export function Menu({editing=false}){
    return <div title={${visible ? 'editing' : '"same"'}} onPointerMoveCapture={editing ? holdFocus : undefined}/>}`
  const files = {
    [data]: component(false),
    [view]:
      'import {Menu} from "./data";export const Page=({show})=> <main>{show && <Menu/>}</main>',
  }
  const changed = {
    [view]:
      'import {Menu} from "./data";export const Page=({show})=> <main>{show && <Menu editing={true}/>}</main>',
  }
  expect((await compareFiles(files, changed, settings)).flagged).toBe(false)
  expect(
    (await compareFiles({ ...files, [data]: component(true) }, changed, settings)).flagged
  ).toBe(true)
})

it.each([1, 4, 24])(
  'retains captured title-map changes at resolution depth %s',
  async (resolutionDepth) => {
    const source = (title: string) =>
      `const titles={fill:'${title}'};export function title(name){return titles[name]}`
    const report = await compareFiles(
      {
        [data]: source('Filling'),
        [view]:
          'import {title} from "./data";export const Page=({name})=> <span>{title(name)}</span>',
      },
      { [data]: source('Filling form') },
      { ...settings, limits: { ...settings.limits, resolutionDepth } }
    )
    expect(report.flagged).toBe(true)
  }
)

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

it.each(['[live, unrelated]', 'await Promise.all([live, unrelated])'])(
  'projects an individual array result from %s',
  async (expression) => {
    const source = (colour: string, telemetry: number) =>
      `export const live='${colour}';export const unrelated=${telemetry}`
    const files = {
      [data]: source('red', 1),
      [view]: `import {live,unrelated} from './data';export async function Page(){const [colour]=${expression};return <span style={{color:colour}}/>}`,
    }
    expect((await compareFiles(files, { [data]: source('red', 2) }, settings)).flagged).toBe(false)
    expect((await compareFiles(files, { [data]: source('blue', 1) }, settings)).flagged).toBe(true)
  }
)

it('keeps shadowed Promise.all conservative', async () => {
  const source = (n: number) => `export const unrelated=${n}`
  const report = await compareFiles(
    {
      [data]: source(1),
      [view]: `import {unrelated} from './data';export async function Page({Promise}){const [colour]=await Promise.all(['red',unrelated]);return <span style={{color:colour}}/>}`,
    },
    { [data]: source(2) },
    settings
  )
  expect(report.flagged).toBe(true)
})

it('projects namespace members even when an outer expression reaches its resolution limit', async () => {
  const source = (colour: string, unused: number) =>
    `export const colour='${colour}';export const unused=${unused}`
  const files = {
    [data]: source('red', 1),
    [view]: `import * as palette from './data';export const Page=()=> <span style={{color:unknown(unknown(unknown(palette.colour)))}}/>`,
  }
  const bounded = { ...settings, limits: { ...settings.limits, resolutionDepth: 2 } }
  expect((await compareFiles(files, { [data]: source('red', 2) }, bounded)).flagged).toBe(false)
  expect((await compareFiles(files, { [data]: source('blue', 1) }, bounded)).flagged).toBe(true)
})

it('bounds expansion of repeated local literal aliases before cloning ASTs', () => {
  const declarations = ['const value0=["red"]']
  for (let index = 1; index < 35; index++)
    declarations.push(`const value${index}=[value${index - 1},value${index - 1}]`)
  const source = `${declarations.join(';')};export const Page=()=> <div data-tree={value34}/>`
  expect(semanticSource(source, view).length).toBeLessThan(100000)
})

it('retains changed call arguments and switched exports when helper dependencies are unchanged', async () => {
  const helpers =
    'export function red(){return "red"};export function blue(){return "blue"};export function paint(colour){return colour}'
  const source = (fn: string, value: string) =>
    `import {${fn} as helper} from './data';export const Page=()=> <span style={{color:helper('${value}')}}/>`
  const files = { [data]: helpers, [view]: source('paint', 'red') }
  expect((await compareFiles(files, { [view]: source('paint', 'blue') }, settings)).flagged).toBe(
    true
  )
  expect(
    (
      await compareFiles(
        { [data]: helpers, [view]: source('red', '') },
        { [view]: source('blue', '') },
        settings
      )
    ).flagged
  ).toBe(true)
})

it('projects JSON import properties without parsing JSON as an application module', async () => {
  const json = 'apps/sim/palette.json'
  const files = {
    [json]: '{"colour":"red","unused":1}',
    [view]:
      'import palette from "./palette.json";export const Page=()=> <span style={{color:palette.colour}}/>',
  }
  expect(
    (await compareFiles(files, { [json]: '{"colour":"red","unused":2}' }, settings)).flagged
  ).toBe(false)
  const report = await compareFiles(files, { [json]: '{"colour":"blue","unused":1}' }, settings)
  expect(report.flagged).toBe(true)
  expect(
    allChanges(report).some(
      (change) => change.category === 'colour' && change.after?.location.file === view
    )
  ).toBe(true)
})

it('retains changed malformed imported JSON as evidence instead of a stable missing value', async () => {
  const json = 'apps/sim/palette.json'
  const report = await compareFiles(
    {
      [json]: '{broken',
      [view]:
        'import palette from "./palette.json";export const Page=()=> <span style={{color:palette.colour}}/>',
    },
    { [json]: '{alsoBroken' },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(allChanges(report).some((change) => change.dependencies.includes(json))).toBe(true)
})

it.each([5, 24])(
  'bounds dynamic environment keys from static feature definitions at depth %s',
  async (resolutionDepth) => {
    const source = (tables: boolean, batch: number) =>
      `import {createEnv} from '@t3-oss/env-nextjs';export const env=createEnv({server:{TABLES:rule(${tables}),BATCH:rule(${batch})}})`
    const files = {
      [data]: source(true, 1),
      [view]: `import {env} from './data';const definitions={table:{fallback:'TABLES'}};export function Page(){const flags={};for(const [name,def] of Object.entries(definitions) as Array<[string,{fallback:string}]>){flags[name]={enabled:env[def.fallback]}}return <span hidden={!flags.table.enabled}/>}`,
    }
    const bounded = { ...settings, limits: { ...settings.limits, resolutionDepth } }
    expect((await compareFiles(files, { [data]: source(true, 2) }, bounded)).flagged).toBe(false)
    expect((await compareFiles(files, { [data]: source(false, 1) }, bounded)).flagged).toBe(true)
  }
)

it.each(['definitions.table.fallback=runtimeKey', 'mutate(definitions)'])(
  'keeps mutated or escaping feature definitions conservative: %s',
  async (mutation) => {
    const source = (batch: number) =>
      `import {createEnv} from '@t3-oss/env-nextjs';export const env=createEnv({server:{TABLES:rule(true),BATCH:rule(${batch})}})`
    const report = await compareFiles(
      {
        [data]: source(1),
        [view]: `import {env} from './data';const definitions={table:{fallback:'TABLES'}};${mutation};export function Page(){const flags={};for(const [name,def] of Object.entries(definitions) as Array<[string,{fallback:string}]>){flags[name]={enabled:env[def.fallback]}}return <span hidden={!flags.table.enabled}/>} `,
      },
      { [data]: source(2) },
      settings
    )
    expect(report.flagged).toBe(true)
  }
)

it('keeps hoisted literal aliases and returned empty records equivalent', async () => {
  const before =
    'export function Page(){const padding={top:16};const empty={};const state={empty};const inset=padding.top;return <div style={{paddingTop:Math.max(inset,1)}} data-state={state}/>}'
  const after =
    'const PADDING={top:16} as const;const EMPTY={};export function Page(){const padding=PADDING;const state={empty:EMPTY};const inset=padding.top;return <div style={{paddingTop:Math.max(inset,1)}} data-state={state}/>}'
  expect((await compareFiles({ [view]: before }, { [view]: after }, settings)).flagged).toBe(false)
})

it('projects selected helper return properties independently of sibling callbacks', async () => {
  const source = (colour: string, destination: string) =>
    `export function useOptions(){const navigate=()=>router.push('${destination}');return {colour:'${colour}',navigate}}`
  const files = {
    [data]: source('red', '/a'),
    [view]:
      'import {useOptions as options} from "./data";export function Page(){const {colour}=options();return <div style={{color:colour}}/>}',
  }
  expect((await compareFiles(files, { [data]: source('red', '/b') }, settings)).flagged).toBe(false)
  expect((await compareFiles(files, { [data]: source('blue', '/a') }, settings)).flagged).toBe(true)
})

it('preserves selected helper return guards, defaults and call arguments', async () => {
  const source = (guard: string) =>
    `export function options(active){if(${guard})return {colour:'red'};return {colour:'blue'}}`
  const page = (arg: string) =>
    `import {options} from './data';export function Page(){const {colour='green'}=options(${arg});return <div style={{color:colour}}/>}`
  const files = { [data]: source('active'), [view]: page('enabled') }
  expect((await compareFiles(files, { [data]: source('!active') }, settings)).flagged).toBe(true)
  expect((await compareFiles(files, { [view]: page('other') }, settings)).flagged).toBe(true)
})

it('retains every changed source while avoiding repeated consumer expansion', async () => {
  const files = {
    [data]: 'export const colour="red"',
    [view]: 'import {colour} from "./data";export const Page=()=> <div style={{color:colour}}/>',
    'apps/sim/second.tsx':
      'import {colour} from "./data";export const Second=()=> <span style={{color:colour}}/>',
    'apps/sim/third.tsx': 'export const Third=()=> <button style={{padding:1}}/>',
  }
  const report = await compareFiles(
    files,
    {
      [data]: 'export const colour="blue"',
      'apps/sim/third.tsx': 'export const Third=()=> <button style={{padding:2}}/>',
    },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(report.findings.map((finding) => finding.source.after?.file).sort()).toEqual(
    [data, 'apps/sim/third.tsx'].sort()
  )
  expect(
    report.findings.find((finding) => finding.source.after?.file === data)?.impact.after
      .referenceCount
  ).toBe(2)
  expect(
    report.limitations.some((limitation) =>
      limitation.includes('Repeated downstream expansion omitted')
    )
  ).toBe(true)
})

it('keeps environment helper changes relevant after schema-key projection', async () => {
  const source = (colour: string) =>
    `import {createEnv} from '@t3-oss/env-nextjs';const read=()=> '${colour}';export const env=createEnv({server:{COLOUR:rule('red'),UNUSED:rule(1)},runtimeEnv:{COLOUR:read()}})`
  const files = {
    [data]: source('red'),
    [view]: 'import {env} from "./data";export const Page=()=> <div style={{color:env.COLOUR}}/>',
  }
  expect((await compareFiles(files, { [data]: source('blue') }, settings)).flagged).toBe(true)
})
