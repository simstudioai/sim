/**
 * Generates the cover images for `/library` posts from their MDX frontmatter.
 *
 * Every cover follows one template: light gray field, the "sim" wordmark
 * top-left, a diagonal open arrow top-right, and the post title set large at
 * the bottom-left. The same template is rendered at request time for docs
 * pages by `apps/docs/app/api/og/route.tsx`; this script is the build-time
 * equivalent for library posts, whose covers ship as static assets so
 * `next/image` can optimize them and the SEO builders can probe their real
 * dimensions.
 *
 * Usage, from the repo root:
 *   bun run library:covers              # write covers for posts that lack one
 *   bun run library:covers --force      # rewrite every post's cover
 *   bun run library:covers <slug>...    # rewrite only the named posts
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CSSProperties } from 'react'
import { ImageResponse } from '@vercel/og'
import { parse as parseFont } from 'opentype.js'
import sharp from 'sharp'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT_DIR = path.join(REPO_ROOT, 'apps/sim/content/library')
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps/sim/public/library')
/**
 * Söhne Kräftig (weight 500), the typeface of the reference cover template,
 * as a plain TTF — Satori (the renderer behind `ImageResponse`) parses neither
 * WOFF2 nor variable fonts. Shared with the docs OG route, which serves this
 * same file over HTTP because it runs on the edge with no filesystem.
 */
const FONT_PATH = path.join(REPO_ROOT, 'apps/docs/public/static/fonts/Soehne-Kraftig.ttf')

const COVER_WIDTH = 1200
const COVER_HEIGHT = 675
/**
 * mozjpeg at 82 lands these covers around 30 KB — in line with the hand-compressed
 * ones they replace. The artwork is a flat field plus large text, so the only detail
 * the encoder has to preserve is glyph edges.
 */
const JPEG_QUALITY = 82

/** Exact hex from a vector trace of the reference cover template, not an estimate off compressed JPEG pixels. */
const INK_COLOR = '#515151'
const BACKGROUND_COLOR = '#c1c1c1'
const TITLE_BOX_WIDTH = 1020
/** Tried largest-first; the first size whose title wraps into at most `MAX_TITLE_LINES` wins. */
const TITLE_FONT_SIZES = [110, 96, 85, 76] as const
/**
 * Four lines of title crowd the wordmark and read as a paragraph rather than a
 * headline. Titles too long to fit in three lines at the smallest step are set
 * at that step anyway and allowed to run to a fourth line.
 */
const MAX_TITLE_LINES = 3

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
const TITLE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  fontWeight: 500,
  color: INK_COLOR,
  lineHeight: 1.1,
  width: `${TITLE_BOX_WIDTH}px`,
  /** Compensates for Satori adding extra invisible leading below the last line instead of splitting it evenly. */
  transform: 'translateY(14px)',
} satisfies CSSProperties

/** Measures a string's rendered width in pixels at `fontSize`, in the cover typeface. */
type TextMeasurer = (text: string, fontSize: number) => number

/**
 * Greedily packs words into lines that fit `TITLE_BOX_WIDTH` at `fontSize`,
 * then joins each line with U+00A0 instead of a plain space. Satori has a
 * text-measurement bug where the first plain space (U+0020) in a text node
 * renders at roughly double width — a non-breaking space measures correctly
 * and reads identically at this size, so it sidesteps the bug instead of
 * fighting Satori's own line-wrapping.
 *
 * Because those non-breaking spaces leave Satori no word boundaries to break
 * on, a line that turns out to overflow gets re-broken at whatever hyphen it
 * happens to contain. That is why widths come from the font's real advance
 * metrics rather than an average-glyph-width estimate: caps-heavy titles
 * ("BYOK Multi-Model AI Agent") run ~15% wider than the average, and
 * under-measuring one lands the break mid-compound in the rendered image.
 */
function wrapTitleLines(title: string, fontSize: number, measure: TextMeasurer): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of title.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (measure(candidate, fontSize) > TITLE_BOX_WIDTH && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)

  return lines.map((line) => line.replace(/ /g, ' '))
}

/** Largest step whose title fits `MAX_TITLE_LINES`, falling back to the smallest step. */
function layoutTitle(title: string, measure: TextMeasurer): { fontSize: number; lines: string[] } {
  let layout: { fontSize: number; lines: string[] } = {
    fontSize: TITLE_FONT_SIZES[0],
    lines: [title],
  }

  for (const fontSize of TITLE_FONT_SIZES) {
    layout = { fontSize, lines: wrapTitleLines(title, fontSize, measure) }
    if (layout.lines.length <= MAX_TITLE_LINES) break
  }

  return layout
}

/** "sim" wordmark, no icon — same brandbook wordmark geometry as the docs navbar/landing OG cards. */
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

async function renderCover(
  title: string,
  fontData: ArrayBuffer,
  measure: TextMeasurer
): Promise<Buffer> {
  const { fontSize, lines } = layoutTitle(title, measure)
  const image = new ImageResponse(
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <SimWordmark />
        <CornerArrow />
      </div>

      <div style={{ ...TITLE_STYLE, fontSize }}>
        {lines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </div>
    </div>,
    {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      fonts: [{ name: 'Soehne', data: fontData, style: 'normal', weight: 500 }],
    }
  )

  const png = Buffer.from(await image.arrayBuffer())
  return await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
}

/**
 * Reads the `title` out of an MDX file's YAML frontmatter without pulling in a
 * YAML parser — the field is a single quoted or bare scalar on one line.
 */
function readFrontmatterTitle(source: string): string | null {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatter) return null

  const title = frontmatter[1].match(/^title:\s*(.+?)\s*$/m)
  if (!title) return null

  const raw = title[1]
  const quoted = raw.match(/^(['"])([\s\S]*)\1$/)
  if (!quoted) return raw
  return quoted[1] === "'" ? quoted[2].replace(/''/g, "'") : quoted[2].replace(/\\(.)/g, '$1')
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const only = new Set(args.filter((arg) => !arg.startsWith('--')))

  const font = await readFile(FONT_PATH)
  const fontData = font.buffer.slice(
    font.byteOffset,
    font.byteOffset + font.byteLength
  ) as ArrayBuffer
  const metrics = parseFont(fontData)
  const measure: TextMeasurer = (text, fontSize) => metrics.getAdvanceWidth(text, fontSize)

  const slugs = (await readdir(CONTENT_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const unknown = [...only].filter((slug) => !slugs.includes(slug))
  if (unknown.length > 0) {
    throw new Error(`No library post for: ${unknown.join(', ')}`)
  }

  let written = 0
  for (const slug of slugs) {
    if (only.size > 0 && !only.has(slug)) continue

    const outputPath = path.join(OUTPUT_DIR, slug, 'cover.jpg')
    if (only.size === 0 && !force && existsSync(outputPath)) continue

    const source = await readFile(path.join(CONTENT_DIR, slug, 'index.mdx'), 'utf8')
    const title = readFrontmatterTitle(source)
    if (!title) {
      throw new Error(`Could not read a \`title\` from frontmatter of ${slug}/index.mdx`)
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, await renderCover(title, fontData, measure))
    written += 1
    console.log(`✓ ${slug}/cover.jpg — "${title}"`)
  }

  console.log(`\n${written} cover${written === 1 ? '' : 's'} written to apps/sim/public/library/`)
}

await main()
