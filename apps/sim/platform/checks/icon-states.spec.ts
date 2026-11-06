import { expect, type Locator, test } from '@playwright/test'

function paint(control: Locator) {
  return control.evaluate((element) => {
    const mark = element.querySelector<SVGGraphicsElement>(
      'svg :is(path, rect, circle, line, polyline, polygon)'
    )
    const matrix = mark?.getScreenCTM()
    if (!mark || !matrix) throw new Error('Missing visible interface glyph')
    const css = getComputedStyle(mark)
    const scale = css.vectorEffect === 'non-scaling-stroke' ? 1 : Math.hypot(matrix.a, matrix.b)
    const brush = document.createElement('canvas').getContext('2d')
    if (!brush) throw new Error('Cannot measure glyph ink')
    brush.fillStyle = css.stroke
    brush.fillRect(0, 0, 1, 1)
    return {
      alpha: brush.getImageData(0, 0, 1, 1).data[3],
      stroke: css.stroke,
      width: Number.parseFloat(css.strokeWidth) * scale,
      surface: getComputedStyle(element).backgroundColor,
    }
  })
}

test('quiet actions and menu rows preserve optical weight and distinguish their hover states', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const theme of ['light', 'dark']) {
    await page.goto(`http://127.0.0.1:3181/home?state=full&theme=${theme}`)
    const sort = page.getByRole('button', { name: 'Sort workspaces' })
    await page.mouse.move(0, 0)
    const quiet = await paint(sort)
    await sort.hover()
    const hovered = await paint(sort)
    expect(hovered.surface).not.toBe(quiet.surface)
    expect(hovered.stroke).toBe(quiet.stroke)
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const docs = page.getByRole('menuitem', { name: 'Documentation' })
    const row = await paint(docs)
    expect(row.stroke).toBe(quiet.stroke)
    expect(quiet.alpha).toBe(255)
    expect(row.alpha).toBe(255)
    await docs.hover()
    const active = await paint(docs)
    expect(active.stroke).not.toBe(row.stroke)
    expect(active.surface).toBe(hovered.surface)
    for (const mark of [hovered, row, active]) expect(mark.width).toBeCloseTo(quiet.width)
    await docs.press('ArrowUp')
    const keyboard = await paint(page.getByRole('menuitem', { name: 'Contact support' }))
    expect(keyboard).toEqual(active)
    await page.keyboard.press('Escape')
  }
})
