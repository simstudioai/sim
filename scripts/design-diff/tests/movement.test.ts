import { expect, it } from 'vitest'
import { allChanges, compareFiles } from '#design-diff/tests/helpers'

const file = 'apps/sim/geometry.tsx'
const svg = (x: number, fill = 'red', extra = '') =>
  `export const A=()=> <svg width="100" height="100" viewBox="0 0 100 100"><rect x={${x}} y={20} width={10} height={10} fill="${fill}" ${extra}/></svg>`

it('exempts movement within SVG media', async () => {
  const report = await compareFiles({ [file]: svg(20) }, { [file]: svg(30) })
  expect(report.flagged).toBe(false)
  expect(allChanges(report)).toEqual([])
})

it('exempts SVG appearance as media', async () => {
  const report = await compareFiles({ [file]: svg(20) }, { [file]: svg(30, 'blue') })
  expect(report.flagged).toBe(false)
  expect(allChanges(report)).toEqual([])
})

it('exempts SVG media regardless of movement proof', async () => {
  const report = await compareFiles(
    { [file]: svg(20), 'apps/sim/global.css': 'rect {width:90px}' },
    { [file]: svg(30) }
  )
  expect(report.flagged).toBe(false)
})

it.each([
  ['clipping', svg(99)],
  ['effects', svg(30, 'red', 'stroke="black"')],
  ['context', svg(30, 'red', 'className="custom"')],
])('exempts media %s', async (_name, after) => {
  const report = await compareFiles({ [file]: svg(20) }, { [file]: after })
  expect(report.flagged).toBe(false)
})

it.each(['marginLeft', 'gap', 'justifyContent', 'position', 'transform'])(
  'does not blanket-exempt %s',
  async (property) => {
    const report = await compareFiles(
      { [file]: `export const A=()=> <div style={{${property}:"1"}}/>` },
      { [file]: `export const A=()=> <div style={{${property}:"2"}}/>` }
    )
    expect(report.flagged).toBe(true)
    expect(allChanges(report)[0].decision).toBe('flag')
  }
)
