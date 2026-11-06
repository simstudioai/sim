import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareVisualBaselines } from '@/scripts/compare-visual-baseline'

const PROTECTED_SHOT = 'settings__general__populated__1440__light.png'
const UNPROTECTED_SHOT = 'shell__home__populated__1440__light.png'
const WIDTH = 100
const HEIGHT = 100
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 }

interface Patch {
  x: number
  y: number
  width: number
  height: number
}

async function png(
  options: { width?: number; height?: number; patch?: Patch; patchShade?: number } = {}
) {
  const width = options.width ?? WIDTH
  const height = options.height ?? HEIGHT
  const base = sharp({ create: { width, height, channels: 4, background: WHITE } })
  if (!options.patch) return base.png().toBuffer()
  const shade = options.patchShade ?? 0
  const overlay = await sharp({
    create: {
      width: options.patch.width,
      height: options.patch.height,
      channels: 4,
      background: shade === 0 ? BLACK : { r: shade, g: shade, b: shade, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  return base
    .composite([{ input: overlay, left: options.patch.x, top: options.patch.y }])
    .png()
    .toBuffer()
}

describe('compareVisualBaselines', () => {
  let root: string
  let baselineDir: string
  let headDir: string

  const writeShot = (directory: string, name: string, content: Buffer | string) => {
    mkdirSync(join(directory, 'shots'), { recursive: true })
    writeFileSync(join(directory, 'shots', name), content)
  }
  const writeContentBox = (
    directory: string,
    file: string,
    contentBox: { x: number; y: number; width: number; height: number }
  ) => {
    writeFileSync(join(directory, 'report.json'), JSON.stringify({ shots: [{ file, contentBox }] }))
  }
  const compare = () => compareVisualBaselines({ baselineDir, headDir })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'visual-baseline-'))
    baselineDir = join(root, 'baseline')
    headDir = join(root, 'head')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reports a resized protected shot as a blocking mismatch instead of misreading its pixels', async () => {
    writeShot(baselineDir, PROTECTED_SHOT, await png())
    writeShot(headDir, PROTECTED_SHOT, await png({ width: 120 }))

    const result = await compare()

    expect(result.passed).toBe(false)
    expect(result.changes).toMatchObject([
      { shot: PROTECTED_SHOT, kind: 'size-mismatch', blocking: true },
    ])
  })

  it('lists a resized unprotected shot without failing', async () => {
    writeShot(baselineDir, UNPROTECTED_SHOT, await png())
    writeShot(headDir, UNPROTECTED_SHOT, await png({ height: 120 }))

    const result = await compare()

    expect(result.passed).toBe(true)
    expect(result.changes).toMatchObject([{ kind: 'size-mismatch', blocking: false }])
  })

  it('fails when a shot vanished from the head run, even in an unprotected area', async () => {
    writeShot(baselineDir, UNPROTECTED_SHOT, await png())
    writeShot(baselineDir, PROTECTED_SHOT, await png())
    writeShot(headDir, PROTECTED_SHOT, await png())

    const result = await compare()

    expect(result.passed).toBe(false)
    expect(result.changes).toMatchObject([
      { shot: UNPROTECTED_SHOT, kind: 'missing-from-head', blocking: true },
    ])
  })

  it('lists a shot only the head run has without failing', async () => {
    writeShot(baselineDir, PROTECTED_SHOT, await png())
    writeShot(headDir, PROTECTED_SHOT, await png())
    writeShot(headDir, UNPROTECTED_SHOT, await png())

    const result = await compare()

    expect(result.passed).toBe(true)
    expect(result.changes).toMatchObject([{ shot: UNPROTECTED_SHOT, kind: 'new-in-head' }])
  })

  it('fails rather than passing when the directories share no shots', async () => {
    const result = await compare()

    expect(result.passed).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('fails on a truncated PNG instead of crashing the whole comparison', async () => {
    const whole = await png()
    writeShot(baselineDir, UNPROTECTED_SHOT, whole)
    writeShot(headDir, UNPROTECTED_SHOT, whole.subarray(0, 20))
    writeShot(baselineDir, PROTECTED_SHOT, whole)
    writeShot(headDir, PROTECTED_SHOT, whole)

    const result = await compare()

    expect(result.passed).toBe(false)
    expect(result.compared).toBe(2)
    expect(result.changes).toMatchObject([{ shot: UNPROTECTED_SHOT, kind: 'unreadable' }])
  })

  it('ignores anti-aliasing noise and a change below the area threshold', async () => {
    writeShot(baselineDir, PROTECTED_SHOT, await png())
    writeShot(
      headDir,
      PROTECTED_SHOT,
      await png({ patch: { x: 0, y: 0, width: 100, height: 100 }, patchShade: 250 })
    )
    writeShot(baselineDir, UNPROTECTED_SHOT, await png({ width: 200, height: 200 }))
    writeShot(
      headDir,
      UNPROTECTED_SHOT,
      await png({ width: 200, height: 200, patch: { x: 0, y: 0, width: 2, height: 2 } })
    )

    const result = await compare()

    expect(result.changes).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('fails on a visible change to a protected page but only lists one elsewhere', async () => {
    const patch = { x: 10, y: 10, width: 30, height: 30 }
    writeShot(baselineDir, PROTECTED_SHOT, await png())
    writeShot(headDir, PROTECTED_SHOT, await png({ patch }))
    writeShot(baselineDir, UNPROTECTED_SHOT, await png())
    writeShot(headDir, UNPROTECTED_SHOT, await png({ patch }))

    const result = await compare()

    expect(result.passed).toBe(false)
    expect(result.changes).toMatchObject([
      { shot: PROTECTED_SHOT, kind: 'changed', blocking: true },
      { shot: UNPROTECTED_SHOT, kind: 'changed', blocking: false },
    ])
  })

  describe('with a recorded content box', () => {
    const contentBox = { x: 40, y: 0, width: 60, height: 100 }

    beforeEach(() => {
      mkdirSync(baselineDir, { recursive: true })
      mkdirSync(headDir, { recursive: true })
      writeContentBox(baselineDir, PROTECTED_SHOT, contentBox)
      writeContentBox(headDir, PROTECTED_SHOT, contentBox)
    })

    it('lets the sidebar change around an identical protected page', async () => {
      writeShot(baselineDir, PROTECTED_SHOT, await png())
      writeShot(
        headDir,
        PROTECTED_SHOT,
        await png({ patch: { x: 0, y: 0, width: 40, height: 100 } })
      )

      const result = await compare()

      expect(result.passed).toBe(true)
      expect(result.changes).toMatchObject([{ kind: 'chrome-only', blocking: false }])
    })

    it('fails when the protected page itself changes', async () => {
      writeShot(baselineDir, PROTECTED_SHOT, await png())
      writeShot(
        headDir,
        PROTECTED_SHOT,
        await png({ patch: { x: 50, y: 10, width: 30, height: 30 } })
      )

      const result = await compare()

      expect(result.passed).toBe(false)
      expect(result.changes).toMatchObject([{ kind: 'changed', blocking: true }])
    })

    it('fails when the sidebar resize squeezes the protected page', async () => {
      writeContentBox(headDir, PROTECTED_SHOT, { x: 50, y: 0, width: 50, height: 100 })
      writeShot(baselineDir, PROTECTED_SHOT, await png())
      writeShot(headDir, PROTECTED_SHOT, await png())

      const result = await compare()

      expect(result.passed).toBe(false)
      expect(result.changes).toMatchObject([{ kind: 'size-mismatch', blocking: true }])
    })
  })
})
