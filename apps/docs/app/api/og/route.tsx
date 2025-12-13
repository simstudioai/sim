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
  const backgroundImageUrl = `${baseUrl}/static/og-background.png`

  const allText = `${title}${category}${description}docs.sim.ai`
  const fontData = await loadGoogleFont('Geist', '400;500;600', allText)

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(315deg, #1e1e3f 0%, #1a1a2e 40%, #0f0f0f 100%)',
        position: 'relative',
        fontFamily: 'Geist',
      }}
    >
      {/* Background texture */}
      <img
        src={backgroundImageUrl}
        alt=''
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.04,
        }}
      />

      {/* Subtle purple glow from bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '50%',
          height: '100%',
          background:
            'radial-gradient(ellipse at bottom right, rgba(112, 31, 252, 0.1) 0%, transparent 50%)',
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
