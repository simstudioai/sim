import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CSSProperties } from 'react'
import { ImageResponse } from 'next/og'
import { parse as parseFont } from 'opentype.js'

/**
 * The brandbook cover template, rendered on demand.
 *
 * One template backs every social card the site generates: light gray field,
 * the "sim" wordmark top-left, a diagonal open arrow top-right, and the title
 * set large at the bottom-left. Library post covers are the build-time
 * rendering of it (`scripts/generate-library-covers.tsx`), docs pages the
 * edge-runtime one (`apps/docs/app/api/og/route.tsx`). This is the Node
 * rendering, for `apps/sim` routes that resolve their title per request.
 */

const COVER_WIDTH = 1200
const COVER_HEIGHT = 675

/** Exact hex from a vector trace of the reference cover template, not an estimate off compressed JPEG pixels. */
const INK_COLOR = '#515151'
const BACKGROUND_COLOR = '#c1c1c1'
/** The title's ink, dropped back so a secondary line reads as caption rather than headline. */
const MUTED_INK_COLOR = 'rgba(81, 81, 81, 0.72)'

/** Tried largest-first; the first size whose title wraps within `COVER_MAX_TITLE_LINES` wins. */
const TITLE_FONT_SIZES = [110, 96, 85] as const
const SUBTITLE_FONT_SIZE = 30
/**
 * How far the title is nudged down to swallow the invisible leading Satori
 * adds below its last line instead of splitting it evenly.
 */
const TITLE_LEADING_NUDGE = 14
/** Intended optical gap between the title's baseline row and the caption. */
const CAPTION_GAP = 18
const ELLIPSIS = '\u2026'
/** Width the title and its caption are laid out into, leaving the right third of the card open. */
export const COVER_TITLE_BOX_WIDTH = 1020
/**
 * Titles here are file names a viewer chose, so nothing upstream bounds their
 * length. Past three lines the block runs off the bottom of the fixed canvas
 * and reads as a paragraph rather than a headline, so the layout steps the
 * type down and then truncates rather than growing.
 */
export const COVER_MAX_TITLE_LINES = 3
/**
 * Captions run from one-line provenance up to a full catalog description, so
 * they wrap — but two lines is the ceiling. A third turns the block into a
 * paragraph competing with the title for the eye, which is the balance the
 * reference template is built around.
 */
export const COVER_MAX_CAPTION_LINES = 2

/**
 * Söhne Kräftig (weight 500), the typeface of the reference cover template, as
 * a plain TTF — Satori (the renderer behind `ImageResponse`) parses neither
 * WOFF2 nor variable fonts.
 *
 * Read once at module scope, per Next's `ImageResponse` guidance, from
 * `public/` so it needs no `outputFileTracingIncludes` entry:
 * `docker/app.Dockerfile` copies that directory into the runner, which
 * per-request cards need since they render outside the build. `process.cwd()`
 * is the app directory in every environment this runs in — Next's generated
 * standalone `server.js` opens with `process.chdir(__dirname)`, and that file
 * ships beside `public/`.
 *
 * Read from the repo rather than fetched, because a fetch that returns nothing
 * throws "No fonts are loaded" out of Satori and takes the whole build down on
 * whichever page happens to be rendering. That was not hypothetical: the
 * retired landing card fetched two Google Fonts weights subsetted per page via
 * `&text=`, a URL no cache can reuse, across `integrations/[slug]` alone at 237
 * pages — several hundred uncacheable requests to one host from one CI egress
 * IP, in parallel across build workers.
 */
const titleFont = await readFile(
  join(process.cwd(), 'public', 'brand', 'fonts', 'Soehne-Kraftig.ttf')
)

/**
 * Real advance widths for the font we actually render with.
 *
 * An average-glyph-width estimate is not good enough here. File names are
 * whatever a viewer named them: a caps-heavy or wide-glyph name runs far past
 * the average and clips off the fixed canvas, while a narrow one wraps early
 * for no reason. Measuring against the same font Satori is handed makes the
 * two agree by construction — including for glyphs Söhne has no coverage for
 * (CJK, emoji), which measure and render at the same notdef advance because
 * this is the only font in the `fonts` array.
 *
 * The library cover generator measures the same way and for the same reason
 * (`scripts/generate-library-covers.tsx`); the docs route falls back to an
 * estimate only because the edge runtime has no filesystem.
 */
const titleFontMetrics = parseFont(
  titleFont.buffer.slice(
    titleFont.byteOffset,
    titleFont.byteOffset + titleFont.byteLength
  ) as ArrayBuffer
)

const CONTAINER_STYLE = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: '26px',
  background: BACKGROUND_COLOR,
  fontFamily: 'Soehne',
} satisfies CSSProperties
const HEADER_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  width: '100%',
} satisfies CSSProperties
const FOOTER_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  width: `${COVER_TITLE_BOX_WIDTH}px`,
} satisfies CSSProperties
const TITLE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  fontWeight: 500,
  color: INK_COLOR,
  lineHeight: 1.1,
  /**
   * Compensates for Satori adding extra invisible leading below the last line
   * instead of splitting it evenly. It belongs on the title block, not on the
   * footer: on the footer it would drag the caption toward the bottom padding
   * too, and the caption has no such leading to correct for.
   */
  transform: `translateY(${TITLE_LEADING_NUDGE}px)`,
} satisfies CSSProperties
const SUBTITLE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  /**
   * The nudge is a transform, so it moves the title visually without moving
   * its layout box — the caption stays put while the title descends into the
   * gap. Adding it back here restores `CAPTION_GAP` as the gap actually seen.
   * The footer is bottom-anchored, so this lifts the title rather than pushing
   * the caption into the bottom padding.
   */
  marginTop: CAPTION_GAP + TITLE_LEADING_NUDGE,
  fontSize: SUBTITLE_FONT_SIZE,
  fontWeight: 500,
  color: MUTED_INK_COLOR,
  lineHeight: 1.2,
} satisfies CSSProperties

/** Whether `text` fits the title box at `fontSize`, by the font's real advance widths. */
function fits(text: string, fontSize: number): boolean {
  return titleFontMetrics.getAdvanceWidth(text, fontSize) <= COVER_TITLE_BOX_WIDTH
}

/** Trims `text` from the right until it plus an ellipsis fits the title box at `fontSize`. */
function withEllipsis(text: string, fontSize: number): string {
  let kept = text
  while (kept && !fits(kept + ELLIPSIS, fontSize)) {
    kept = kept.slice(0, -1)
  }
  return kept + ELLIPSIS
}

/** Greedily packs `pieces` into chunks that each fit the title box at `fontSize`. */
function packChunks(pieces: string[], fontSize: number): string[] {
  const chunks: string[] = []
  let chunk = ''

  for (const piece of pieces) {
    const candidate = chunk + piece
    if (!fits(candidate, fontSize) && chunk) {
      chunks.push(chunk)
      chunk = piece
    } else {
      chunk = candidate
    }
  }
  if (chunk) chunks.push(chunk)

  return chunks
}

/**
 * Splits a single word wider than the title box into chunks that each fit.
 *
 * Hyphens are tried first because that is where a reader expects a compound to
 * break, and the trailing hyphen stays on the upper line. A chunk with no
 * usable hyphen falls back to a character-level split — which file names, the
 * titles this renders, reach constantly.
 */
function splitOversizedWord(word: string, fontSize: number): string[] {
  const afterHyphens = packChunks(word.split(/(?<=-)/), fontSize)

  return afterHyphens.flatMap((chunk) =>
    fits(chunk, fontSize) ? [chunk] : packChunks([...chunk], fontSize)
  )
}

/**
 * Greedily packs words into lines that fit `COVER_TITLE_BOX_WIDTH` at
 * `fontSize`, joining them with U+00A0 rather than a plain space.
 *
 * Satori has a text-measurement bug where the first plain space (U+0020) in a
 * text node renders at roughly double width; a non-breaking space measures
 * correctly and reads identically at these sizes, so this sidesteps the bug
 * rather than fighting Satori's own line-wrapping, which is disabled here
 * since lines arrive pre-split. The U+00A0 goes in as the line is packed, so
 * what gets measured is exactly what gets rendered.
 */
function wrapLines(text: string, fontSize: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(' ')) {
    if (!fits(word, fontSize)) {
      if (current) {
        lines.push(current)
        current = ''
      }
      const chunks = splitOversizedWord(word, fontSize)
      lines.push(...chunks.slice(0, -1))
      current = chunks[chunks.length - 1] ?? ''
      continue
    }

    const candidate = current ? `${current}\u00a0${word}` : word
    if (!fits(candidate, fontSize) && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)

  return lines
}

/** "sim" wordmark, no icon — the brandbook wordmark geometry the docs navbar and library covers use. */
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

export const COVER_OG_SIZE = { width: COVER_WIDTH, height: COVER_HEIGHT } as const

interface CoverOgImageProps {
  title: string
  /** Optional caption under the title — provenance, a description, a byline. */
  subtitle?: string
}

interface CoverLayout {
  fontSize: number
  lines: string[]
  subtitleLines: string[]
}

/**
 * Largest type size at which the title fits `COVER_MAX_TITLE_LINES`, with the
 * overflow truncated at the smallest step, and the caption wrapped to at most
 * `COVER_MAX_CAPTION_LINES`.
 *
 * Separate from the render so the bound is assertable: every string this
 * returns has to sit inside the fixed canvas, and on the shared-file card both
 * inputs — a file name and a workspace/owner pair — are supplied by whoever
 * created the share.
 */
export function layoutCover({ title, subtitle }: CoverOgImageProps): CoverLayout {
  const smallest = TITLE_FONT_SIZES[TITLE_FONT_SIZES.length - 1]
  let fontSize = smallest
  let lines: string[] = []

  for (const step of TITLE_FONT_SIZES) {
    fontSize = step
    lines = wrapLines(title, step)
    if (lines.length <= COVER_MAX_TITLE_LINES) break
  }

  if (lines.length > COVER_MAX_TITLE_LINES) {
    lines = lines.slice(0, COVER_MAX_TITLE_LINES)
    lines[lines.length - 1] = withEllipsis(lines[lines.length - 1], smallest)
  }

  return { fontSize, lines, subtitleLines: subtitle ? layoutCaption(subtitle) : [] }
}

/**
 * Wraps a caption to at most `COVER_MAX_CAPTION_LINES`, ellipsizing the last
 * line if it still overruns. The lines have to be pre-split here for the same
 * reason the title's are: packing them with U+00A0 leaves Satori no break
 * opportunity, so an unsplit caption would run straight off the right edge
 * rather than wrapping.
 */
function layoutCaption(subtitle: string): string[] {
  const lines = wrapLines(subtitle, SUBTITLE_FONT_SIZE)
  if (lines.length <= COVER_MAX_CAPTION_LINES) return lines

  const kept = lines.slice(0, COVER_MAX_CAPTION_LINES)
  kept[kept.length - 1] = withEllipsis(kept[kept.length - 1], SUBTITLE_FONT_SIZE)
  return kept
}

/** Renders the brandbook cover template for a single title. */
export function createCoverOgImage(props: CoverOgImageProps) {
  const { fontSize, lines, subtitleLines } = layoutCover(props)

  return new ImageResponse(
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <SimWordmark />
        <CornerArrow />
      </div>

      <div style={FOOTER_STYLE}>
        <div style={{ ...TITLE_STYLE, fontSize }}>
          {lines.map((line, index) => (
            <span key={index}>{line}</span>
          ))}
        </div>
        {subtitleLines.length > 0 ? (
          <div style={SUBTITLE_STYLE}>
            {subtitleLines.map((line, index) => (
              <span key={index}>{line}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    {
      ...COVER_OG_SIZE,
      fonts: [{ name: 'Soehne', data: titleFont, style: 'normal' as const, weight: 500 as const }],
    }
  )
}
