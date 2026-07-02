import { ImageResponse } from 'next/og'
import { SimLogoFull } from '@/app/(landing)/components/og-sim-logo'

const size = {
  width: 1200,
  height: 630,
}

const TITLE_FONT_SIZE = {
  large: 64,
  medium: 56,
  small: 48,
} as const

function getTitleFontSize(title: string): number {
  if (title.length > 42) return TITLE_FONT_SIZE.small
  if (title.length > 26) return TITLE_FONT_SIZE.medium
  return TITLE_FONT_SIZE.large
}

async function loadGoogleFont(
  font: string,
  weights: string,
  text: string
): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=${font}:wght@${weights}&text=${encodeURIComponent(text)}`
    const css = await (await fetch(url)).text()
    const resource = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype|woff2?)'\)/)

    if (resource) {
      const response = await fetch(resource[1])
      if (response.status === 200) {
        return await response.arrayBuffer()
      }
    }
  } catch {
    return null
  }

  return null
}

interface LandingOgImageProps {
  eyebrow: string
  title: string
  subtitle: string
  pills?: string[]
  domainLabel?: string
}

/** Shared dynamic OG image for landing catalog pages (models, integrations). */
export async function createLandingOgImage({
  eyebrow,
  title,
  subtitle,
  pills = [],
  domainLabel = 'sim.ai',
}: LandingOgImageProps) {
  const text = `${eyebrow}${title}${subtitle}${pills.join('')}${domainLabel}`
  const [regularFontData, mediumFontData] = await Promise.all([
    loadGoogleFont('Geist', '400', text),
    loadGoogleFont('Geist', '500', text),
  ])

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 64px',
        background: '#121212',
        fontFamily: 'Geist',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: '#71717a',
            letterSpacing: '-0.01em',
          }}
        >
          {eyebrow}
        </span>

        <span
          style={{
            fontSize: getTitleFontSize(title),
            fontWeight: 500,
            color: '#fafafa',
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
            maxWidth: '1000px',
          }}
        >
          {title}
        </span>

        <span
          style={{
            fontSize: 28,
            fontWeight: 400,
            color: '#a1a1aa',
            lineHeight: 1.35,
            maxWidth: '980px',
          }}
        >
          {subtitle}
        </span>

        {pills.length > 0 ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            {pills.slice(0, 4).map((pill) => (
              <div
                key={pill}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 9999,
                  border: '1px solid #2f2f2f',
                  background: '#1b1b1b',
                  padding: '10px 16px',
                  color: '#d4d4d8',
                  fontSize: 20,
                  fontWeight: 500,
                }}
              >
                {pill}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <SimLogoFull />
        <span
          style={{
            fontSize: 20,
            fontWeight: 400,
            color: '#71717a',
          }}
        >
          {domainLabel}
        </span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        ...(regularFontData
          ? [
              {
                name: 'Geist',
                data: regularFontData,
                style: 'normal' as const,
                weight: 400 as const,
              },
            ]
          : []),
        ...(mediumFontData
          ? [
              {
                name: 'Geist',
                data: mediumFontData,
                style: 'normal' as const,
                weight: 500 as const,
              },
            ]
          : []),
      ],
    }
  )
}
