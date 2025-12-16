import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

const TITLE_FONT_SIZE = {
  large: 64,
  medium: 56,
  small: 48,
} as const

function getTitleFontSize(title: string): number {
  if (title.length > 45) return TITLE_FONT_SIZE.small
  if (title.length > 30) return TITLE_FONT_SIZE.medium
  return TITLE_FONT_SIZE.large
}

/**
 * Loads a Google Font dynamically by fetching the CSS and extracting the font URL.
 */
async function loadGoogleFont(font: string, weights: string, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${font}:wght@${weights}&text=${encodeURIComponent(text)}`
  const css = await (await fetch(url)).text()
  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/)

  if (resource) {
    const response = await fetch(resource[1])
    if (response.status === 200) {
      return await response.arrayBuffer()
    }
  }

  throw new Error('Failed to load font data')
}

/**
 * Generates dynamic Open Graph images for documentation pages.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Documentation'
  const category = searchParams.get('category') || 'DOCUMENTATION'
  const description = searchParams.get('description') || ''

  const baseUrl = new URL(request.url).origin

  const allText = `${title}${category}${description}docs.sim.ai`
  const fontData = await loadGoogleFont('Geist', '400;500;600', allText)

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0c0c0c',
        position: 'relative',
        fontFamily: 'Geist',
      }}
    >
      {/* Base gradient layer - very subtle purple tint across the entire image */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'radial-gradient(ellipse 150% 100% at 50% 100%, rgba(88, 28, 135, 0.15) 0%, rgba(88, 28, 135, 0.08) 25%, rgba(88, 28, 135, 0.03) 50%, transparent 80%)',
          display: 'flex',
        }}
      />

      {/* Secondary glow - adds depth without harsh edges */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'radial-gradient(ellipse 100% 80% at 80% 90%, rgba(112, 31, 252, 0.12) 0%, rgba(112, 31, 252, 0.04) 40%, transparent 70%)',
          display: 'flex',
        }}
      />

      {/* Top darkening - creates natural vignette */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, transparent 40%, transparent 100%)',
          display: 'flex',
        }}
      />

      {/* Content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 72px',
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        {/* Logo */}
        <img src={`${baseUrl}/static/logo.png`} alt='sim' height={32} />

        {/* Category + Title + Description */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: '#802fff',
              letterSpacing: '0.02em',
            }}
          >
            {category}
          </span>
          <span
            style={{
              fontSize: getTitleFontSize(title),
              fontWeight: 600,
              color: '#ffffff',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </span>
          {description && (
            <span
              style={{
                fontSize: 18,
                fontWeight: 400,
                color: '#a1a1aa',
                lineHeight: 1.4,
                marginTop: 4,
              }}
            >
              {description.length > 100 ? `${description.slice(0, 100)}...` : description}
            </span>
          )}
        </div>

        {/* Footer */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: '#52525b',
          }}
        >
          docs.sim.ai
        </span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Geist',
          data: fontData,
          style: 'normal',
        },
      ],
    }
  )
}
