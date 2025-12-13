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
async function loadGoogleFont(font: string, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${font}:wght@500;600&text=${encodeURIComponent(text)}`
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

  const baseUrl = new URL(request.url).origin
  const backgroundImageUrl = `${baseUrl}/static/og-background.png`

  // Load Inter font dynamically from Google Fonts
  const allText = `${title}${category}docs.sim.ai`
  const fontData = await loadGoogleFont('Inter', allText)

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#121212',
        position: 'relative',
        fontFamily: 'Inter',
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
          opacity: 0.06,
        }}
      />

      {/* Content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '60px 72px',
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        {/* Logo */}
        <img src={`${baseUrl}/static/logo.png`} alt='sim' height={36} />

        {/* Category + Title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: '#737373',
              letterSpacing: '0.08em',
            }}
          >
            {category}
          </span>
          <span
            style={{
              fontSize: getTitleFontSize(title),
              fontWeight: 600,
              color: '#ffffff',
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </span>
        </div>

        {/* Footer */}
        <span
          style={{
            fontSize: 16,
            fontWeight: 400,
            color: '#525252',
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
          name: 'Inter',
          data: fontData,
          style: 'normal',
        },
      ],
    }
  )
}
