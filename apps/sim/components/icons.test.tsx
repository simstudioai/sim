/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoogleIcon } from '@/components/icons'

const PNG_DATA_URI_PATTERN = /href="data:image\/png;base64,([^"]+)"/g
const GOOGLE_ICON_PNG_SHA256 = 'd1ce9c2af0b10a7333abc99bc706f9a6a199e5b65bf3e3009624f076b8638e6a'

function getEmbeddedPng(markup: string): Buffer {
  const match = PNG_DATA_URI_PATTERN.exec(markup)
  expect(match).not.toBeNull()
  PNG_DATA_URI_PATTERN.lastIndex = 0
  return Buffer.from(match?.[1] ?? '', 'base64')
}

describe('GoogleIcon', () => {
  it('renders the exact official transparent artwork and forwards SVG props', () => {
    const markup = renderToStaticMarkup(
      <GoogleIcon className='google-icon' data-testid='google-icon' aria-label='Google' />
    )

    expect(markup).toContain('viewBox="0 0 204 204"')
    expect(markup).toContain('width="24"')
    expect(markup).toContain('height="24"')
    expect(markup).toContain('class="google-icon"')
    expect(markup).toContain('data-testid="google-icon"')
    expect(markup).toContain('aria-label="Google"')
    expect(markup).toContain('<image')
    expect(markup).toContain('width="200"')
    expect(markup).toContain('height="204"')
    expect(markup).toContain('preserveAspectRatio="xMinYMin meet"')

    const png = getEmbeddedPng(markup)
    expect(png).toHaveLength(33_661)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBe(200)
    expect(png.readUInt32BE(20)).toBe(204)
    expect(createHash('sha256').update(png).digest('hex')).toBe(GOOGLE_ICON_PNG_SHA256)
  })

  it('avoids the WebKit-fragile SVG paint stack across multiple instances', () => {
    const markup = renderToStaticMarkup(
      <>
        <GoogleIcon />
        <GoogleIcon />
      </>
    )

    expect(markup.match(/<svg\b/g)).toHaveLength(2)
    expect(markup.match(/<image\b/g)).toHaveLength(2)
    expect(markup.match(PNG_DATA_URI_PATTERN)).toHaveLength(2)
    expect(markup).not.toMatch(/<(?:foreignObject|mask|filter|clipPath)\b/)
    expect(markup).not.toContain('conic-gradient')
    expect(markup).not.toContain('url(#')
    expect(markup).not.toMatch(/\sid=/)
  })
})
