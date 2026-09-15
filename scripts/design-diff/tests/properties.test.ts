import { expect, it } from 'vitest'
import { GitReader } from '#design-diff/git'
import { SourceTree } from '#design-diff/source'
import { compareFiles, config, FixtureRepo } from '#design-diff/tests/helpers'

it.each(['div', 'figure'])(
  'distinguishes a passive %s media container from a mixed control layout',
  async (tag) => {
    const file = 'apps/sim/view.tsx'
    const media = `export const View=()=> <${tag} style={{padding:4}}><img src="example.png"/></${tag}>`
    expect(
      (await compareFiles({ [file]: media }, { [file]: media.replace('padding:4', 'padding:8') }))
        .flagged
    ).toBe(false)
    const mixed = media.replace('<img', '<button>Save</button><img')
    expect(
      (await compareFiles({ [file]: mixed }, { [file]: mixed.replace('padding:4', 'padding:8') }))
        .flagged
    ).toBe(true)
  }
)

it('keeps equivalent composition and local extraction distinct from changed overrides', async () => {
  const file = 'apps/sim/widget.tsx'
  const before =
    'import {cn} from "@/lib/utils";export const Widget=()=> <button className={cn("p-2", "rounded-none")}/>'
  const equivalent =
    'import {cn as compose} from "@/lib/utils";const spacing="p-2";export const Widget=()=> <button className={compose(spacing, "rounded-none")}/>'
  expect((await compareFiles({ [file]: before }, { [file]: equivalent })).flagged).toBe(false)
  expect(
    (await compareFiles({ [file]: before }, { [file]: equivalent.replace('"p-2"', '"p-4"') }))
      .flagged
  ).toBe(true)
})

it.each([
  ['palette', 'control', 'colour'],
  ['settings', 'frame', 'width'],
])(
  'tracks %s properties independently of neighboring functional values',
  async (binding, branch, property) => {
    const module = 'apps/sim/settings.ts'
    const page = 'apps/sim/view.tsx'
    const source = (value: string, retry: number) =>
      `export const ${binding}={${branch}:{${property}:${value}},backend:{retry:${retry}}}`
    const before = {
      [module]: source('4', 1),
      [page]: `import {${binding} as data} from './settings';export const Page=()=> <button style={{width:data.${branch}.${property}}}/>`,
    }
    expect(
      (await compareFiles(before, { [module]: source('4', 9) }, { ...config, themes: [] })).flagged
    ).toBe(false)
    expect(
      (await compareFiles(before, { [module]: source('8', 1) }, { ...config, themes: [] })).flagged
    ).toBe(true)
    const repo = new FixtureRepo()
    try {
      const base = repo.commit(before)
      const head = repo.commit({ [module]: source('4', 9) })
      const a = new SourceTree(new GitReader(repo.cwd), base, config)
      const b = new SourceTree(new GitReader(repo.cwd), head, config)
      a.buildGraph()
      b.buildGraph()
      expect(a.graph.causes(new Set([module]), b.graph).has(page)).toBe(false)
    } finally {
      repo.close()
    }
  }
)

it.each(['object.paint', 'object["paint"]', 'object.section.paint'])(
  'preserves relevant helper changes through %s',
  async (read) => {
    const module = 'apps/sim/palette.ts'
    const before = {
      [module]: 'const tone=()=>"red";export const object={paint:tone(),section:{paint:tone()}}',
      'apps/sim/page.tsx': `import {object} from './palette';export const Page=()=> <div style={{color:${read}}}/>`,
    }
    expect(
      (
        await compareFiles(
          before,
          { [module]: before[module].replace('"red"', '"blue"') },
          { ...config, themes: [] }
        )
      ).flagged
    ).toBe(true)
  }
)
