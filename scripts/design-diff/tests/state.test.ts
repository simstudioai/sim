import { expect, it } from 'vitest'
import { allChanges, compareFiles, config } from '#design-diff/tests/helpers'

const view = 'apps/sim/page.tsx'
const settings = { ...config, themes: [] }

it.each([
  ['named', "import {useState} from 'react'", 'useState'],
  ['alias', "import {useState as state} from 'react'", 'state'],
  ['namespace', "import * as React from 'react'", 'React.useState'],
  ['default', "import React from 'react'", 'React.useState'],
])('traces error copy assigned through a %s React state binding', async (_name, imports, hook) => {
  const source = (message: string) => `${imports};const ERROR='${message}';
    export function Page(){const [errors,setErrors]=${hook}([]);
    async function submit(){try {await signIn()}catch {setErrors([ERROR])}}
    return <form onSubmit={submit}><span>{errors.join(', ')}</span></form>}`
  const report = await compareFiles(
    { [view]: source('Try again') },
    { [view]: source('Check your email and try again') },
    settings
  )
  expect(report.flagged).toBe(true)
  expect(allChanges(report).some((change) => change.after?.location.file === view)).toBe(true)
})

it.each([
  ['colour', "'red'", "'blue'", 'style={{color:value}}'],
  ['padding', '2', '4', 'style={{padding:value}}'],
  ['visibility', 'false', 'true', 'hidden={value}'],
  ['functional update', "old => old + 'a'", "old => old + 'b'", 'title={value}'],
])('traces state-driven %s changes through setter aliases', async (_name, before, after, prop) => {
  const source = (update: string) => `import {useState} from 'react';
    export function Page(){const [value,setValue]=useState(null);const update=setValue;
    function click(){update(${update})}return <button onClick={click} ${prop}/>}`
  expect(
    (await compareFiles({ [view]: source(before) }, { [view]: source(after) }, settings)).flagged
  ).toBe(true)
})

it('keeps unrelated handler telemetry and unrendered state clean', async () => {
  const source = (message: string) => `import {useState} from 'react';
    export function Page(){const [value,setValue]=useState('ready');
    const [unused,setUnused]=useState('');function click(){logger.info('${message}');
    setUnused('${message}');setValue('done')}return <button onClick={click}>{value}</button>}`
  expect(
    (await compareFiles({ [view]: source('before') }, { [view]: source('after') }, settings))
      .flagged
  ).toBe(false)
})

it('retains conditions controlling a rendered state update', async () => {
  const source = (guard: string) => `import {useState} from 'react';
    export function Page({a,b}){const [value,setValue]=useState('ready');
    function click(){if(${guard})setValue('done')}return <button onClick={click}>{value}</button>}`
  expect(
    (await compareFiles({ [view]: source('a') }, { [view]: source('b') }, settings)).flagged
  ).toBe(true)
})

it('does not trust a local function merely named useState', async () => {
  const source = (message: string) => `function useState(){return ['ready',logger.info]}
    export function Page(){const [value,setValue]=useState();
    function click(){setValue('${message}')}return <button onClick={click}>{value}</button>}`
  expect(
    (await compareFiles({ [view]: source('before') }, { [view]: source('after') }, settings))
      .flagged
  ).toBe(false)
})

it('retains the branch containing a state update', async () => {
  const source = (body: string) => `import {useState} from 'react';
    export function Page({ready}){const [value,setValue]=useState('ready');
    function click(){${body}}return <button onClick={click}>{value}</button>}`
  expect(
    (
      await compareFiles(
        { [view]: source("if(ready){setValue('done')}else{}") },
        { [view]: source("if(ready){}else{setValue('done')}") },
        settings
      )
    ).flagged
  ).toBe(true)
})

it('keeps a state/setter rename and constant hoist equivalent', async () => {
  const before = `import {useState} from 'react';export function Page(){
    const [value,setValue]=useState('ready');function click(){setValue('done')}
    return <button onClick={click}>{value}</button>}`
  const after = `import {useState} from 'react';const DONE='done';export function Page(){
    const [label,setLabel]=useState('ready');function click(){setLabel(DONE)}
    return <button onClick={click}>{label}</button>}`
  expect((await compareFiles({ [view]: before }, { [view]: after }, settings)).flagged).toBe(false)
})
