import { describe, expect, it } from 'vitest'
import { allChanges, compareFiles } from '#design-diff/tests/helpers'

const file = 'apps/sim/components/page.tsx'
const shared = 'apps/sim/components/button.tsx'
const imports = 'import {Button} from "./button";'
const button = 'export const Button=(props)=> <button {...props}/>'

describe('designer notification policy', () => {
  it.each([
    ['copy', '<p>Loading</p>', '<p>Searching</p>'],
    [
      'options',
      '<select><option>A</option></select>',
      '<select><option>A</option><option>B</option></select>',
    ],
    ['shared control', '<main/>', '<main><Button variant="primary" size="sm">Add</Button></main>'],
    ['icon', '<Icon color="red" size={12}/>', '<Icon color="blue" size={24}/>'],
    ['image sizing', '<img src="a.png" className="w-10"/>', '<img src="b.png" className="w-20"/>'],
    ['inline SVG', '<svg><path d="M0 0"/></svg>', '<svg><path d="M1 1"/></svg>'],
    [
      'runtime guard',
      '<div className={ready ? "p-2" : "p-4"}/>',
      '<div className={enabled ? "p-2" : "p-4"}/>',
    ],
    [
      'unknown appearance',
      '<div style={{color: runtime(1)}}/>',
      '<div style={{color: runtime(2)}}/>',
    ],
    [
      'pure translation',
      '<div style={{transform:"translateX(1px)"}}/>',
      '<div style={{transform:"translateX(2px)"}}/>',
    ],
    ['class translation', '<div className="translate-x-1"/>', '<div className="translate-x-2"/>'],
    [
      'insert shared variant',
      '<main><Button variant="primary"/></main>',
      '<main><Button variant="secondary"/><Button variant="primary"/></main>',
    ],
    [
      'background artwork',
      '<div className="bg-[url(/a.png)]"/>',
      '<div className="bg-[url(/b.png)]"/>',
    ],
  ])('exempts %s', async (_name, a, b) => {
    const report = await compareFiles(
      { [file]: `${imports} export const Page=()=> ${a}`, [shared]: button },
      { [file]: `${imports} export const Page=()=> ${b}` }
    )
    expect(report.flagged).toBe(false)
  })

  it.each([
    ['custom control', '<main/>', '<main><button className="rounded-none p-2"/></main>'],
    ['shared override', '<main/>', '<main><Button className="rounded-none"/></main>'],
    ['existing variant', '<Button variant="primary"/>', '<Button variant="secondary"/>'],
    ['new override on existing control', '<Button/>', '<Button variant="secondary"/>'],
    ['colour', '<div className="text-red-500"/>', '<div className="text-blue-500"/>'],
    ['padding', '<div className="p-0"/>', '<div className="p-2"/>'],
    [
      'conditional style',
      '<div className={ready ? "p-2" : "p-4"}/>',
      '<div className={ready ? "p-3" : "p-4"}/>',
    ],
    ['layout', '<div className="flex gap-2"/>', '<div className="flex gap-4"/>'],
    ['scale', '<div style={{transform:"scale(1)"}}/>', '<div style={{transform:"scale(2)"}}/>'],
    [
      'mixed movement and appearance',
      '<div className="translate-x-1 p-2"/>',
      '<div className="translate-x-2 p-4"/>',
    ],
  ])('flags %s', async (_name, a, b) => {
    const report = await compareFiles(
      { [file]: `${imports} export const Page=()=> ${a}`, [shared]: button },
      { [file]: `${imports} export const Page=()=> ${b}` }
    )
    expect(report.flagged).toBe(true)
    expect(allChanges(report).some((change) => change.decision === 'flag')).toBe(true)
  })

  it('exempts adding another identically styled dropdown option without shifting later evidence', async () => {
    const a =
      'export const Page=()=> <><Option className="p-2">A</Option><Option className="p-4">End</Option></>'
    const b =
      'export const Page=()=> <><Option className="p-2">A</Option><Option className="p-2">B</Option><Option className="p-4">End</Option></>'
    expect((await compareFiles({ [file]: a }, { [file]: b })).flagged).toBe(false)
  })

  it('tracks an imported appearance token without flagging unrelated properties', async () => {
    const token = 'apps/sim/components/theme.ts'
    const source =
      'import {theme} from "./theme"; export const Page=()=> <div style={{color:theme.colour}}/>'
    const base = { [file]: source, [token]: 'export const theme={colour:"red",label:"Before"}' }
    expect(
      (await compareFiles(base, { [token]: 'export const theme={colour:"red",label:"After"}' }))
        .flagged
    ).toBe(false)
    const report = await compareFiles(base, {
      [token]: 'export const theme={colour:"blue",label:"Before"}',
    })
    expect(report.flagged).toBe(true)
    expect(report.findings.some((group) => group.source.after?.file === token)).toBe(true)
  })

  it('flags an authored default colour on a shared component', async () => {
    const source = (colour: string) =>
      `export function Button({color="${colour}"}){return <button style={{color}}/>}`
    expect(
      (await compareFiles({ [shared]: source('red') }, { [shared]: source('blue') })).flagged
    ).toBe(true)
  })

  it.each([
    [
      'lucide-react',
      'export const Page=()=> <Glyph className="size-4"/>',
      'export const Page=()=> <Glyph className="size-8"/>',
    ],
    [
      'next/image',
      'export const Page=()=> <Glyph width={100}/>',
      'export const Page=()=> <Glyph width={200}/>',
    ],
  ])('recognizes aliased media imports from %s', async (module, a, b) => {
    const prefix = `import Glyph from '${module}';`
    expect((await compareFiles({ [file]: prefix + a }, { [file]: prefix + b })).flagged).toBe(false)
  })

  it('exempts deleting a standard branded documentation card', async () => {
    const doc = 'apps/docs/content/evernote.mdx'
    const source =
      'import {BlockInfoCard} from "@/components/ui/block-info-card"\n\n<BlockInfoCard type="evernote" color="#FFFFFF"/>'
    expect((await compareFiles({ [doc]: source }, { [doc]: null })).flagged).toBe(false)
    expect(
      (await compareFiles({ [doc]: source }, { [doc]: source.replace('#FFFFFF', '#FF0000') }))
        .flagged
    ).toBe(false)
  })

  it('flags an appearance override added to an existing MDX component', async () => {
    const doc = 'apps/docs/content/page.mdx'
    expect(
      (await compareFiles({ [doc]: '<Callout/>' }, { [doc]: '<Callout variant="compact"/>' }))
        .flagged
    ).toBe(true)
  })

  it('exempts deleted orphan component clusters but retains active component removals', async () => {
    const a = 'apps/sim/components/unused.tsx'
    const b = 'apps/sim/components/unused-wrapper.tsx'
    const files = {
      [a]: 'export const Unused=()=> <div className="p-2"/>',
      [b]: 'import {Unused} from "./unused";export const Wrapper=()=> <Unused/>',
    }
    expect((await compareFiles(files, { [a]: null, [b]: null })).flagged).toBe(false)
    expect((await compareFiles(files, { [a]: null })).flagged).toBe(true)
  })

  it('retains font replacements while ignoring binary image replacements', async () => {
    const font = 'apps/sim/public/brand/font.woff2'
    const image = 'apps/sim/public/brand/cover.png'
    expect(
      (await compareFiles({ [font]: Buffer.from([0, 1, 2]) }, { [font]: Buffer.from([0, 1, 3]) }))
        .flagged
    ).toBe(true)
    expect(
      (await compareFiles({ [image]: Buffer.from([0, 1, 2]) }, { [image]: Buffer.from([0, 1, 3]) }))
        .flagged
    ).toBe(false)
  })
})
