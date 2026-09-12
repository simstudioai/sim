import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyze } from '#design-diff/analyze'
import { allChanges, compareFiles, config, FixtureRepo } from '#design-diff/tests/helpers'

const cases: { name: string; before: string; after: string; category: string }[] = JSON.parse(
  readFileSync(new URL('fixtures/visual-cases.json', import.meta.url), 'utf8')
)
const file = 'apps/sim/components/button.tsx'

describe('visual policy integration', () => {
  it.each(cases)('classifies $name', async (fixture) => {
    const report = await compareFiles({ [file]: fixture.before }, { [file]: fixture.after })
    expect(report.status).toBe('completed')
    expect(report.flagged).toBe(fixture.category !== 'content')
    if (fixture.category !== 'content')
      expect(allChanges(report).some((finding) => finding.category === fixture.category)).toBe(true)
    expect(
      allChanges(report).every(
        (finding) => finding.before?.location.file === file || finding.after?.location.file === file
      )
    ).toBe(true)
  })

  it.each([
    [
      'comments',
      'export const A=()=> <div>Hi</div>',
      '/** Changed comment */\nexport const A=()=> <div>Hi</div>',
    ],
    [
      'formatting',
      'export const A=()=> <div>Hi</div>',
      'export const A = () => (\n  <div>Hi</div>\n)',
    ],
    [
      'types',
      'type T = string; export const A=()=> <div>Hi</div>',
      'type T = number; export const A=()=> <div>Hi</div>',
    ],
    [
      'constant extraction',
      'export const A=()=> <div className="p-4"/>',
      'const pad="p-4"; export const A=()=> <div className={pad}/>',
    ],
    [
      'handler',
      'export const A=()=> <button onClick={()=>log(1)}>Hi</button>',
      'export const A=()=> <button onClick={()=>log(2)}>Hi</button>',
    ],
  ])('ignores supported %s noops', async (_name, before, after) => {
    const report = await compareFiles(
      { [file]: before },
      { [file]: after },
      { ...config, themes: [] }
    )
    expect(allChanges(report)).toEqual([])
    expect(report.flagged).toBe(false)
  })

  it('ignores class delimiter spacing', async () => {
    const report = await compareFiles(
      { [file]: 'export const A=()=> <div className="p-4  w-full"/>' },
      { [file]: 'export const A=()=> <div className="p-4 w-full"/>' },
      { ...config, themes: [] }
    )
    expect(report.flagged).toBe(false)
  })

  it('exempts wording-only JSX whitespace', async () => {
    const report = await compareFiles(
      { [file]: 'export const A=()=> <div><b>A</b> <b>B</b></div>' },
      { [file]: 'export const A=()=> <div><b>A</b><b>B</b></div>' }
    )
    expect(report.flagged).toBe(false)
  })

  it('does not flag unknown spread precedence without concrete appearance values', async () => {
    const report = await compareFiles(
      { [file]: 'export const A=(props)=> <div {...props} className="p-2"/>' },
      { [file]: 'export const A=(props)=> <div className="p-2" {...props}/>' }
    )
    expect(report.flagged).toBe(false)
  })

  it('exempts functional early-return changes', async () => {
    const report = await compareFiles(
      { [file]: 'export function A({enabled}){if(!enabled)return null;return <div>Hi</div>}' },
      { [file]: 'export function A({enabled}){if(enabled)return null;return <div>Hi</div>}' }
    )
    expect(report.flagged).toBe(false)
  })

  it('exempts functional markup selection', async () => {
    const report = await compareFiles(
      {
        [file]:
          'export function A({mode}){switch(mode){case "one":return <div>Hi</div>;default:return null}}',
      },
      {
        [file]:
          'export function A({mode}){switch(mode){case "two":return <div>Hi</div>;default:return null}}',
      }
    )
    expect(report.flagged).toBe(false)
  })

  it('records unsupported mutable bindings without notifying', async () => {
    const report = await compareFiles(
      {
        [file]:
          'let colour="red";if(enabled)colour="blue";export const A=()=> <div style={{color:colour}}/>',
      },
      {
        [file]:
          'let colour="red";if(enabled)colour="green";export const A=()=> <div style={{color:colour}}/>',
      }
    )
    expect(report.flagged).toBe(false)
    expect(allChanges(report).some((finding) => finding.decision === 'flag')).toBe(false)
  })

  it('keeps parser failures exempt with explicit coverage notes', async () => {
    const report = await compareFiles(
      { [file]: 'export const A=()=> <div />' },
      { [file]: 'export const A=()=> <div' }
    )
    expect(report.status).toBe('completed')
    expect(allChanges(report).some((finding) => finding.decision === 'flag')).toBe(false)
  })

  it('has deterministic ordering, IDs and commit metadata', async () => {
    const repo = new FixtureRepo()
    try {
      const base = repo.commit({ [file]: cases[0].before })
      const head = repo.commit({ [file]: cases[0].after })
      const a = await analyze(repo.cwd, base, head, config)
      const b = await analyze(repo.cwd, base, head, config)
      expect(a).toEqual(b)
      expect(a.commits).toEqual({ base, head, mergeBase: base })
      expect(a.findings[0].id).toMatch(/^[a-f0-9]{24}$/)
    } finally {
      repo.close()
    }
  })
})
