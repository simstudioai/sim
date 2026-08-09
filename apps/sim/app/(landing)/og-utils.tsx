import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/**
 * Geist, read from the repo rather than fetched from Google Fonts.
 *
 * Satori requires at least one font and throws if it gets none, so a fetch that
 * returned nothing took the whole build down with "No fonts are loaded" on
 * whichever page happened to be rendering. That was not a rare race: six routes
 * build an OG image, `integrations/[slug]` alone is 237 pages, and each render
 * fetched two weights subsetted by `&text=` — a per-page URL no cache can reuse.
 * Several hundred uncacheable requests to one host, from one CI egress IP, in
 * parallel across build workers.
 *
 * Read once at module scope, per Next's `ImageResponse` guidance. `.ttf`
 * because Satori accepts only ttf/otf/woff — the sibling `.woff2` the app
 * serves to browsers cannot be reused here.
 *
 * These live under `public/` so they need no `outputFileTracingIncludes` entry:
 * `docker/app.Dockerfile` copies that directory into the runner, which the
 * `force-dynamic` share-token card needs since it renders per request.
 *
 * `process.cwd()` is the app directory in every environment this runs in, not
 * just dev and build. The container starts at the monorepo root, but Next's
 * generated standalone `server.js` opens with `process.chdir(__dirname)`, and
 * that file ships beside `public/` — which is also why `content/` is read this
 * way at runtime.
 */
const FONT_DIR = join(process.cwd(), 'public', 'brand', 'fonts')

const [geistRegular, geistMedium] = await Promise.all([
  readFile(join(FONT_DIR, 'Geist-Regular.ttf')),
  readFile(join(FONT_DIR, 'Geist-Medium.ttf')),
])

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
        { name: 'Geist', data: geistRegular, style: 'normal' as const, weight: 400 as const },
        { name: 'Geist', data: geistMedium, style: 'normal' as const, weight: 500 as const },
      ],
    }
  )
}
