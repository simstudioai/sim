import type { CSSProperties } from 'react'
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

const TITLE_FONT_SIZE = {
  large: 110,
  medium: 96,
  small: 85,
} as const
/** Average glyph width as a fraction of font size, for this weight/family — used to pack words into lines. */
const LATIN_CHAR_WIDTH_EM = 0.42
/** CJK glyphs (docs ships `ja`/`zh` locales) render near-square, roughly 2.4x a Latin glyph at this weight. */
const CJK_CHAR_WIDTH_EM = 1
const CJK_RANGE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/
const TITLE_BOX_WIDTH = 1020
const FONT_CACHE_REVALIDATE_SECONDS = 60 * 60 * 24 * 30
/** Exact hex from a vector trace of the reference cover template, not an estimate off compressed JPEG pixels. */
const INK_COLOR = '#515151'
const OG_CONTAINER_STYLE = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: '26px',
  background: '#c1c1c1',
  fontFamily: 'Soehne',
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
  fontWeight: 500,
  color: INK_COLOR,
  lineHeight: 1.1,
  width: `${TITLE_BOX_WIDTH}px`,
  /** Compensates for Satori adding extra invisible leading below the last line instead of splitting it evenly. */
  transform: 'translateY(14px)',
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

/** Sums per-character em-widths rather than counting characters, so wide CJK glyphs (docs ships `ja`/`zh`) don't under-wrap. */
function estimateWidthEm(text: string): number {
  let width = 0
  for (const char of text) {
    width += CJK_RANGE.test(char) ? CJK_CHAR_WIDTH_EM : LATIN_CHAR_WIDTH_EM
  }
  return width
}

/**
 * Splits a single word wider than `maxWidthEm` into character-level chunks
 * that each fit. CJK titles (docs ships `ja`/`zh` locales) are often
 * space-free, so a whole run can arrive as one "word" from `wrapTitleLines`'
 * space-based split. Breaking mid-word is correct for CJK, where each glyph
 * is independently readable; Latin words never reach this path since they
 * stay under `maxWidthEm` in practice.
 */
function splitOversizedWord(word: string, maxWidthEm: number): string[] {
  const chunks: string[] = []
  let chunk = ''

  for (const char of word) {
    const candidate = chunk + char
    if (estimateWidthEm(candidate) > maxWidthEm && chunk) {
      chunks.push(chunk)
      chunk = char
    } else {
      chunk = candidate
    }
  }
  if (chunk) chunks.push(chunk)

  return chunks
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
interface TitleLine {
  text: string
  sourceOffset: number
}

function wrapTitleLines(title: string, fontSize: number): TitleLine[] {
  const maxWidthEm = TITLE_BOX_WIDTH / fontSize
  const words = title.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (estimateWidthEm(word) > maxWidthEm) {
      if (current) {
        lines.push(current)
        current = ''
      }
      const chunks = splitOversizedWord(word, maxWidthEm)
      lines.push(...chunks.slice(0, -1))
      current = chunks[chunks.length - 1] ?? ''
      continue
    }

    const candidate = current ? `${current} ${word}` : word
    if (estimateWidthEm(candidate) > maxWidthEm && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)

  let lineOffset = 0
  return lines.map((line) => {
    const sourceOffset = lineOffset
    lineOffset += line.length + 1
    return { text: line.replace(/ /g, ' '), sourceOffset }
  })
}

/**
 * Loads Söhne Kräftig (weight 500), the typeface used on the reference cover
 * template this OG image matches. Converted to a plain TTF from the
 * last-shipped `soehne-kraftig.woff2` since Satori (`next/og`'s renderer)
 * can't parse WOFF2 or variable fonts. Fetched over HTTP since the edge
 * runtime has no filesystem access — served from `/static/fonts/` (not
 * `/fonts/`) so it isn't intercepted by the site's i18n proxy (`proxy.ts`),
 * whose matcher excludes `static` but not `fonts`.
 */
async function loadTitleFont(baseUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(new URL('/static/fonts/Soehne-Kraftig.ttf', baseUrl), {
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
        d='M0 293.75h53.41c0 14.75 5.34 26.51 16.02 35.27 10.68 8.37 25.12 12.55 43.32 12.55 19.78 0 35.02-3.79 45.7-11.36 10.68-7.97 16.02-18.53 16.02-31.69 0-9.57-2.97-17.54-8.9-23.91-5.54-6.38-15.83-11.56-30.86-15.54l-51.04-11.96c-25.72-6.38-44.91-16.14-57.57-29.3-12.27-13.15-18.4-30.49-18.4-52.02 0-17.94 4.55-33.48 13.65-46.63 9.5-13.15 22.35-23.32 38.58-30.49 16.62-7.17 35.61-10.76 56.97-10.76 21.36 0 39.76 3.79 55.19 11.36 15.83 7.57 28.09 18.14 36.8 31.69 9.1 13.55 13.85 29.7 14.24 48.43h-53.41c-0.4-15.15-5.34-26.9-14.84-35.27-9.49-8.37-22.75-12.55-39.76-12.55-17.41 0-30.86 3.79-40.36 11.36-9.5 7.57-14.24 17.94-14.24 31.09 0 19.53 14.24 32.88 42.73 40.06l51.04 12.56c24.53 5.58 42.93 14.75 55.19 27.5 12.27 12.36 18.4 29.3 18.4 50.82 0 18.34-4.95 34.48-14.84 48.43-9.89 13.55-23.54 24.11-40.95 31.69-17.01 7.17-37.19 10.76-60.53 10.76-34.03 0-61.13-8.37-81.31-25.11-20.18-16.74-30.27-39.06-30.27-66.96z'
        fill={INK_COLOR}
      />
      <path
        d='m267.18 385.83v-292.36c22.24 8.13 32.05 8.13 55.79 0v292.36zm27.3-311.69c-9.89 0-18.6-3.59-26.11-10.76-7.12-7.57-10.68-16.34-10.68-26.31 0-10.36 3.56-19.13 10.68-26.31 7.52-7.17 16.22-10.76 26.11-10.76 10.29 0 18.99 3.59 26.11 10.76 7.12 7.17 10.68 15.94 10.68 26.31 0 9.96-3.56 18.73-10.68 26.31-7.12 7.17-15.83 10.76-26.11 10.76z'
        fill={INK_COLOR}
      />
      <path
        d='m421.36 385.82h-55.79v-292.36h49.85v49.33c5.93-16.34 17.41-30.2 33.23-40.96 16.22-11.16 35.81-16.74 58.75-16.74 25.72 0 47.08 6.98 64.1 20.93 17.01 13.95 28.09 32.48 33.23 55.6h-10.09c3.96-23.12 14.84-41.65 32.64-55.6 17.8-13.95 39.76-20.93 65.88-20.93 33.23 0 59.35 9.77 78.34 29.3 18.99 19.53 28.49 46.24 28.49 80.12v191.32h-54.6v-177.57c0-23.12-5.93-40.85-17.8-53.21-11.47-12.76-27.1-19.13-46.88-19.13-13.85 0-26.11 3.19-36.8 9.57-10.29 5.98-18.4 14.75-24.33 26.31-5.93 11.56-8.9 25.11-8.9 40.66v173.38h-55.19v-178.17c0-23.12-5.74-40.66-17.21-52.61-11.47-12.36-27.1-18.53-46.88-18.53-13.85 0-26.11 3.19-36.8 9.57-10.29 5.98-18.4 14.75-24.33 26.31-5.93 11.16-8.9 24.51-8.9 40.06z'
        fill={INK_COLOR}
      />
    </svg>
  )
}

/** Diagonal "open" arrow, top-right — square caps and a miter join to match the reference's sharp corners. */
function CornerArrow() {
  return (
    <svg width='58' height='58' viewBox='0 0 24 24' fill='none'>
      <path
        d='M2 22 22 2M22 2H12M22 2V12'
        stroke={INK_COLOR}
        strokeWidth={3.6}
        strokeLinecap='square'
        strokeLinejoin='miter'
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

  const fontData = await loadTitleFont(request.url)
  const fontSize = getTitleFontSize(title)
  const titleLines = wrapTitleLines(title, fontSize)

  return new ImageResponse(
    <div style={OG_CONTAINER_STYLE}>
      <div style={OG_HEADER_STYLE}>
        <SimWordmark />
        <CornerArrow />
      </div>

      <div style={getTitleStyle(title)}>
        {titleLines.map((line) => (
          <span key={line.sourceOffset}>{line.text}</span>
        ))}
      </div>
    </div>,
    {
      width: 1200,
      height: 675,
      fonts: [
        {
          name: 'Soehne',
          data: fontData,
          style: 'normal',
          weight: 500,
        },
      ],
    }
  )
}
