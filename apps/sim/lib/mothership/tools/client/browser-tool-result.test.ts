import { describe, expect, it } from 'vitest'
import { sanitizeBrowserToolResultForModel } from '@/lib/mothership/tools/client/browser-tool-result'

describe('browser screenshot model projection', () => {
  it('keeps an image usable when an older desktop omits coordinate metadata', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toContain('cssX =')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '0.5'])(
    'does not publish an invalid scale %s',
    (scale) => {
      const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
        scale,
        viewport: { width: 1600, height: 900 },
      })
      expect(result?.content).toContain('Viewport: 1600 × 900 CSS pixels')
      expect(result?.content).toContain('coordinate mapping is unavailable')
      expect(result?.content).not.toContain('cssX =')
    }
  )

  it('does not invent a crop origin or encode malformed dimensions into the caption', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 2,
      clip: { x: '10', y: 20 },
      viewport: { width: 0, height: 900 },
      imageSize: { width: Number.POSITIVE_INFINITY, height: 640 },
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toMatch(/Viewport:|Encoded image:|Crop origin:|cssX =/)
  })

  it('maps each crop axis independently when pixel rounding changes its aspect ratio', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 2.5,
      clip: { x: 0, y: 20, width: 1.5, height: 100 },
      imageSize: { width: 3, height: 200 },
    })
    expect(result?.content).toContain('Crop origin: (0, 20) in viewport CSS pixels')
    expect(result?.content).toContain('cssX = 0 + imageX / 2; cssY = 20 + imageY / 2')
  })

  it('keeps a legacy crop image without publishing its unverified scalar mapping', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 3 / 1.1,
      clip: { x: 0.1, y: 20, width: 1.1, height: 100 },
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toContain('cssX =')
  })

  it('uses both encoded dimensions for a resized viewport', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 0.5,
      viewport: { width: 1600, height: 901 },
      imageSize: { width: 800, height: 451 },
    })
    expect(result?.content).toContain(`cssX = 0 + imageX / 0.5; cssY = 0 + imageY / ${451 / 901}`)
  })

  it('withholds a legacy viewport scalar when encoded dimensions are unavailable', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 0.5,
      viewport: { width: 2048, height: 1025 },
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.scale).toBe(0.5)
    expect(result?.content).toContain('Viewport: 2048 × 1025 CSS pixels')
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toContain('cssY =')
  })

  it('leaves non-image tool results unchanged', () => {
    const result = { outline: 'button "Continue" [ref=3]' }
    expect(sanitizeBrowserToolResultForModel('browser_snapshot', result)).toBe(result)
    expect(sanitizeBrowserToolResultForModel('browser_snapshot', undefined)).toBeUndefined()
  })
})
