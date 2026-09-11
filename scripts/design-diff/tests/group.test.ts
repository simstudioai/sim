import { expect, it } from 'vitest'
import { allChanges, compareFiles, config } from '#design-diff/tests/helpers'

const button = 'packages/emcn/src/button.tsx'
const icon = 'packages/emcn/src/icon.tsx'
const index = 'packages/emcn/src/index.ts'
const consumer = 'apps/sim/page.tsx'
const unrelated = 'apps/sim/icon-only.tsx'
const settings = { ...config, themes: [] }
const fixture = {
  'packages/emcn/package.json': '{"name":"@sim/emcn","exports":"./src/index.ts"}',
  [button]: 'export const Button=(props)=> <button className="rounded-md" {...props}/>',
  [icon]: 'export const Icon=()=> <svg/>',
  [index]: 'export * from "./button";export * from "./icon"',
  [consumer]:
    'import {Button} from "@sim/emcn";export const A=()=> <div><Button disabled={busy}/><Button/></div>',
  [unrelated]:
    'import {Icon} from "@sim/emcn";export const A=()=> <Icon className={dynamicStyle}/>',
}

it('groups a shared change once and counts only references to its defining module', async () => {
  const report = await compareFiles(
    fixture,
    { [button]: fixture[button].replace('rounded-md', 'rounded-none') },
    settings
  )
  expect(report.findings).toHaveLength(1)
  const finding = report.findings[0]
  expect(finding.decision).toBe('flag')
  expect(finding.source.after?.file).toBe(button)
  expect(finding.changes).toHaveLength(1)
  expect(finding.category).toBe('shape-effects')
  expect(finding.impact.before.referenceCount).toBe(2)
  expect(finding.impact.after.referenceCount).toBe(2)
  expect(finding.impact.after.fileCount).toBe(1)
  expect(finding.consumers).toEqual([consumer])
  expect(finding.example?.change.after?.location.file).toBe(consumer)
  expect(finding.limitations.join(' ')).toContain('not confirmed visual changes')
  expect(JSON.stringify(report.findings)).not.toContain(unrelated)
})

it('retains multiple direct changes under one source without dropping their categories', async () => {
  const report = await compareFiles(
    { [consumer]: 'export const A=()=> <button style={{color:"red",padding:4}}/>' },
    { [consumer]: 'export const A=()=> <button style={{color:"blue",padding:8}}/>' },
    settings
  )
  expect(report.findings).toHaveLength(1)
  expect(report.findings[0].changes).toHaveLength(2)
  expect(report.findings[0].categories).toEqual(['colour', 'dimensions'])
})

it('anchors imported token changes at their source and retains one changed consumer example', async () => {
  const token = 'apps/sim/token.ts'
  const second = 'apps/sim/second.tsx'
  const view = 'import {colour} from "./token";export const A=()=> <button style={{color:colour}}/>'
  const report = await compareFiles(
    { [token]: 'export const colour="red"', [consumer]: view, [second]: view },
    { [token]: 'export const colour="blue"' },
    settings
  )
  expect(report.findings).toHaveLength(1)
  const finding = report.findings[0]
  expect(finding.source.before?.file).toBe(token)
  expect(finding.source.after?.file).toBe(token)
  expect(finding.changes).toEqual([])
  expect(finding.example?.basis).toBe('changed-definition')
  expect(finding.example?.change.before?.value).toBe('red')
  expect(finding.example?.change.after?.value).toBe('blue')
  expect(finding.consumers).toEqual([consumer, second].sort())
  expect(finding.impact.after.referenceCount).toBe(2)
})

it('keeps independent changed sources separate, including shared consumers', async () => {
  const a = 'apps/sim/a.ts'
  const b = 'apps/sim/b.ts'
  const report = await compareFiles(
    {
      [a]: 'export const colour="red"',
      [b]: 'export const padding=4',
      [consumer]:
        'import {colour} from "./a";import {padding} from "./b";export const A=()=> <div style={{color:colour,padding}}/>',
    },
    { [a]: 'export const colour="blue"', [b]: 'export const padding=8' },
    settings
  )
  expect(report.findings.map((finding) => finding.source.after?.file)).toEqual([a, b])
  expect(report.findings.every((finding) => finding.decision === 'flag')).toBe(true)
})

it('uses only binary decisions while retaining uncertainty and operational failure separately', async () => {
  const report = await compareFiles(
    { [consumer]: 'export const A=()=> <div className={unknown("a")}/>' },
    { [consumer]: 'export const A=()=> <div className={unknown("b")}/>' },
    settings
  )
  expect(report.schemaVersion).toBe('3.0.0')
  expect(report.policyVersion).toBe('3.0.0')
  expect(report.status).toBe('completed')
  expect(report.flagged).toBe(true)
  expect(report.findings.every((finding) => finding.decision === 'flag')).toBe(true)
  expect(allChanges(report).every((change) => change.decision === 'flag')).toBe(true)
  expect(report.findings[0].limitations).toContain('Function call is not executed')
})
