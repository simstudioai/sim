import type { CSSProperties } from 'react'
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

const TITLE_FONT_SIZE = {
  large: 88,
  medium: 76,
  small: 68,
} as const
/** Average glyph width as a fraction of font size, for this weight/family — used to pack words into lines. */
const AVG_CHAR_WIDTH_EM = 0.5
const TITLE_BOX_WIDTH = 1020
const FONT_CACHE_REVALIDATE_SECONDS = 60 * 60 * 24 * 30
// Measured directly off the reference cover template
// (apps/sim/public/library/best-zapier-alternatives/cover.jpg): #c3c3c3
// background, median ink #525252, ~26px margin on every edge.
const INK_COLOR = '#525252'
const OG_CONTAINER_STYLE = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: '26px',
  background: '#c3c3c3',
  fontFamily: 'Season',
} satisfies CSSProperties
const OG_HEADER_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  width: '100%',
} satisfies CSSProperties
const OG_TITLE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  fontWeight: 600,
  color: INK_COLOR,
  lineHeight: 1.15,
  width: `${TITLE_BOX_WIDTH}px`,
} satisfies CSSProperties

function getTitleFontSize(title: string): number {
  if (title.length > 45) return TITLE_FONT_SIZE.small
  if (title.length > 30) return TITLE_FONT_SIZE.medium
  return TITLE_FONT_SIZE.large
}

function getTitleStyle(title: string): CSSProperties {
  return {
    ...OG_TITLE_STYLE,
    fontSize: getTitleFontSize(title),
  }
}

/**
 * Greedily packs words into lines that fit `TITLE_BOX_WIDTH` at `fontSize`,
 * then joins each line with U+00A0 instead of a plain space. Satori
 * (`next/og`'s renderer) has a text-measurement bug where the first plain
 * space (U+0020) in a text node renders at roughly double width — a
 * non-breaking space measures correctly and reads identically at this size,
 * so it sidesteps the bug instead of fighting Satori's own line-wrapping
 * (which is also disabled here — lines are pre-split, not auto-wrapped).
 */
function wrapTitleLines(title: string, fontSize: number): string[] {
  const maxCharsPerLine = Math.floor(TITLE_BOX_WIDTH / (fontSize * AVG_CHAR_WIDTH_EM))
  const words = title.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)

  return lines.map((line) => line.replace(/ /g, ' '))
}

/**
 * Loads a static (600/semibold) TTF instance of the site's own Season Sans
 * font — the platform's real brand/body font, also used by the library/blog
 * cover template this OG image matches. Instantiated from the variable font
 * at `apps/docs/app/fonts/SeasonSansUprightsVF.woff2` (`fonttools
 * varLib.instancer wght=600`, then flavor-stripped to plain TTF) rather than
 * loading the variable WOFF2 directly: Satori (`next/og`'s renderer) can't
 * parse variable fonts without excessive memory use, and can't parse WOFF2
 * at all ("Unsupported OpenType signature wOF2") — it needs an uncompressed
 * TTF/OTF. Fetched over HTTP since the edge runtime has no filesystem access
 * — served from `/static/fonts/` (not `/fonts/`) so it isn't intercepted by
 * the site's i18n proxy (`proxy.ts`), whose matcher excludes `static` but
 * not `fonts`.
 */
async function loadSeasonFont(baseUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(new URL('/static/fonts/SeasonSans-600-static.ttf', baseUrl), {
    next: { revalidate: FONT_CACHE_REVALIDATE_SECONDS },
  })

  if (!response.ok) {
    throw new Error(`Failed to load font data: ${response.status} ${response.statusText}`)
  }

  return await response.arrayBuffer()
}

/** "sim" wordmark, no icon — same brandbook workmark geometry as the docs navbar/landing OG cards. */
function SimWordmark() {
  return (
    <svg width='118' height='57' viewBox='0 0 800 386' fill='none'>
      <path
        d='M0 293.75h53.4128c0 14.748 5.3413 26.506 16.0239 35.275 10.6826 8.37 25.1238 12.555 43.3233 12.555 19.783 0 35.016-3.786 45.698-11.36 10.683-7.971 16.024-18.534 16.024-31.687 0-9.566-2.967-17.538-8.902-23.915-5.539-6.378-15.826-11.559-30.861-15.545l-51.0389-11.958c-25.7173-6.377-44.9063-16.142-57.5672-29.296-12.2651-13.153-18.39771-30.491-18.39771-52.015 0-17.936 4.55001-33.481 13.64991-46.635 9.4957-13.153 22.3543-23.3169 38.576-30.4914 16.6173-7.1745 35.6086-10.7619 56.9739-10.7619 21.365 0 39.763 3.7866 55.193 11.3598 15.826 7.5731 28.091 18.1355 36.796 31.6875 9.1 13.552 13.847 29.695 14.243 48.428h-53.413c-.395-15.146-5.341-26.904-14.837-35.275-9.495-8.37-22.75-12.555-39.763-12.555-17.4083 0-30.8604 3.786-40.356 11.36-9.4956 7.573-14.2434 17.936-14.2434 31.089 0 19.531 14.2434 32.884 42.7304 40.058l51.039 12.556c24.53 5.58 42.928 14.747 55.193 27.502 12.265 12.356 18.398 29.296 18.398 50.82 0 18.335-4.946 34.477-14.837 48.428-9.891 13.552-23.541 24.114-40.95 31.687-17.013 7.175-37.191 10.762-60.534 10.762-34.0265 0-61.1285-8.37-81.3067-25.111-20.1782-16.74-30.2673-39.061-30.2673-66.962z'
        fill={INK_COLOR}
      />
      <path
        d='m267.175 385.826v-292.3631c22.244 8.1331 32.053 8.1331 55.787 0v292.3631zm27.3-311.6891c-9.891 0-18.596-3.5872-26.113-10.7618-7.122-7.5731-10.683-16.342-10.683-26.3067 0-10.3632 3.561-19.132 10.683-26.3066 7.517-7.17453 16.222-10.7618 26.113-10.7618 10.287 0 18.991 3.58727 26.113 10.7618 7.122 7.1746 10.682 15.9434 10.682 26.3066 0 9.9647-3.56 18.7336-10.682 26.3067-7.122 7.1746-15.826 10.7618-26.113 10.7618z'
        fill={INK_COLOR}
      />
      <path
        d='m421.362 385.823h-55.786v-292.3624h49.852v49.3294c5.934-16.342 17.408-30.197 33.234-40.959 16.222-11.1605 35.807-16.7407 58.754-16.7407 25.718 0 47.083 6.9752 64.096 20.9257 17.013 13.951 28.091 32.485 33.234 55.603h-10.089c3.957-23.118 14.837-41.652 32.642-55.603 17.804-13.9505 39.762-20.9257 65.875-20.9257 33.235 0 59.348 9.7653 78.339 29.2957 18.991 19.531 28.487 46.236 28.487 80.116v191.321h-54.6v-177.57c0-23.118-5.934-40.855-17.804-53.211-11.474-12.755-27.102-19.132-46.885-19.132-13.847 0-26.113 3.189-36.795 9.566-10.287 5.979-18.398 14.748-24.333 26.307-5.934 11.559-8.902 25.111-8.902 40.655v173.385h-55.193v-178.168c0-23.118-5.737-40.655-17.211-52.613-11.474-12.356-27.102-18.534-46.885-18.534-13.847 0-26.112 3.189-36.795 9.566-10.287 5.979-18.398 14.748-24.333 26.307-5.934 11.16-8.902 24.513-8.902 40.057z'
        fill={INK_COLOR}
      />
    </svg>
  )
}

/** Diagonal "open" arrow, top-right — matches the library/blog cover template. */
function CornerArrow() {
  return (
    <svg width='56' height='56' viewBox='0 0 24 24' fill='none'>
      <path
        d='M7 17 17 7M17 7H9M17 7V15'
        stroke={INK_COLOR}
        strokeWidth={3.6}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

/**
 * Generates dynamic Open Graph images for documentation pages. Matches the
 * site's library/blog cover template: light gray background, "sim" wordmark
 * top-left, an open/diagonal arrow top-right, and the page title large and
 * bold at the bottom-left.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Documentation'

  const fontData = await loadSeasonFont(request.url)
  const fontSize = getTitleFontSize(title)
  const titleLines = wrapTitleLines(title, fontSize)

  return new ImageResponse(
    <div style={OG_CONTAINER_STYLE}>
      <div style={OG_HEADER_STYLE}>
        <SimWordmark />
        <CornerArrow />
      </div>

      <div style={getTitleStyle(title)}>
        {titleLines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </div>
    </div>,
    {
      width: 1200,
      height: 675,
      fonts: [
        {
          name: 'Season',
          data: fontData,
          style: 'normal',
          weight: 600,
        },
      ],
    }
  )
}
