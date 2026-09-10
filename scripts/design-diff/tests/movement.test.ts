import { expect, it } from 'vitest'
import { compareFiles } from '#design-diff/tests/helpers'

const file = 'apps/sim/icon.tsx'
const svg = (x: number, fill = 'red', extra = '') =>
  `export const A=()=> <svg width="100" height="100" viewBox="0 0 100 100"><rect x={${x}} y={20} width={10} height={10} fill="${fill}" ${extra}/></svg>`

it('exempts a supported bounded movement', async () => {
  const report = await compareFiles({ [file]: svg(20) }, { [file]: svg(30) })
  expect(report.flagged).toBe(false)
  expect(report.findings.map((finding) => finding.decision)).toEqual(['exempt'])
})

it('flags mixed movement and appearance', async () => {
  const report = await compareFiles({ [file]: svg(20) }, { [file]: svg(30, 'blue') })
  expect(report.flagged).toBe(true)
  expect(report.findings.some((finding) => finding.category === 'colour')).toBe(true)
})

it('does not claim a movement proof when stylesheet rules can override the primitive', async () => {
  const report = await compareFiles(
    { [file]: svg(20), 'apps/sim/global.css': 'rect {width:90px}' },
    { [file]: svg(30) }
  )
  expect(report.flagged).toBe(true)
})

it.each([
  ['clipping', svg(99)],
  ['effects', svg(30, 'red', 'stroke="black"')],
  ['context', svg(30, 'red', 'className="custom"')],
])('requires review for %s', async (_name, after) => {
  const report = await compareFiles({ [file]: svg(20) }, { [file]: after })
  expect(report.flagged).toBe(true)
})

it.each(['marginLeft', 'gap', 'justifyContent', 'position', 'transform'])(
  'does not blanket-exempt %s',
  async (property) => {
    const report = await compareFiles(
      { [file]: `export const A=()=> <div style={{${property}:"1"}}/>` },
      { [file]: `export const A=()=> <div style={{${property}:"2"}}/>` }
    )
    expect(report.flagged).toBe(true)
    expect(report.findings[0].decision).toBe('review')
  }
)
