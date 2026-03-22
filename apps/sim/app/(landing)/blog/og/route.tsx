import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { getPostMetaBySlug } from '@/lib/blog/registry'
import { formatDate } from '@/lib/core/utils/formatting'
import { getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

export const runtime = 'nodejs'

async function getLogoDataUrl(): Promise<string> {
  const logoPath = join(process.cwd(), 'public', 'logo', 'sim-landing.svg')
  const buffer = await readFile(logoPath)
  return `data:image/svg+xml;base64,${buffer.toString('base64')}`
}

function getTitleFontSize(title: string): number {
  if (title.length > 80) return 36
  if (title.length > 60) return 40
  if (title.length > 40) return 48
  return 56
}

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

function Block({
  x,
  y,
  w,
  h,
  color,
  opacity = 1,
}: {
  x: number
  y: number
  w: number
  h: number
  color: string
  opacity?: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 2.6,
        backgroundColor: color,
        opacity,
      }}
    />
  )
}

function BlocksLeft() {
  return (
    <div style={{ display: 'flex', position: 'relative', width: 34, height: 226 }}>
      <Block x={0} y={0} w={34} h={34} color='#FA4EDF' opacity={0.6} />
      <Block x={0} y={0} w={17} h={17} color='#FA4EDF' />
      <Block x={17} y={0} w={17} h={68} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={17} w={17} h={17} color='#FA4EDF' />
      <Block x={0} y={52} w={34} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={85} w={17} h={141} color='#00F701' opacity={0.6} />
      <Block x={0} y={120} w={17} h={17} color='#FFCC02' />
      <Block x={0} y={120} w={17} h={34} color='#FFCC02' opacity={0.4} />
      <Block x={0} y={154} w={17} h={17} color='#00F701' />
      <Block x={0} y={154} w={34} h={34} color='#00F701' opacity={0.5} />
    </div>
  )
}

function BlocksRight() {
  return (
    <div style={{ display: 'flex', position: 'relative', width: 34, height: 205 }}>
      <Block x={0} y={0} w={17} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={0} w={17} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={0} w={34} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={17} w={17} h={68} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={34} w={17} h={17} color='#FA4EDF' />
      <Block x={0} y={34} w={34} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={0} y={69} w={34} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={17} y={102} w={17} h={102} color='#2ABBF8' opacity={0.6} />
      <Block x={0} y={137} w={17} h={17} color='#00F701' />
      <Block x={0} y={137} w={17} h={34} color='#00F701' opacity={0.4} />
    </div>
  )
}

function BlocksTopRight() {
  return (
    <div style={{ display: 'flex', position: 'relative', width: 295, height: 34 }}>
      <Block x={0} y={0} w={17} h={34} color='#2ABBF8' />
      <Block x={0} y={0} w={17} h={17} color='#2ABBF8' />
      <Block x={0} y={0} w={85} h={17} color='#2ABBF8' opacity={0.6} />
      <Block x={34} y={0} w={34} h={34} color='#2ABBF8' opacity={0.6} />
      <Block x={34} y={0} w={17} h={17} color='#2ABBF8' />
      <Block x={52} y={17} w={17} h={17} color='#2ABBF8' />
      <Block x={68} y={0} w={55} h={17} color='#00F701' />
      <Block x={106} y={0} w={34} h={34} color='#00F701' opacity={0.6} />
      <Block x={106} y={0} w={51} h={17} color='#00F701' opacity={0.6} />
      <Block x={124} y={17} w={17} h={17} color='#00F701' />
      <Block x={157} y={0} w={34} h={17} color='#FFCC02' opacity={0.6} />
      <Block x={157} y={0} w={17} h={17} color='#FFCC02' />
      <Block x={209} y={0} w={17} h={34} color='#FA4EDF' opacity={0.6} />
      <Block x={209} y={0} w={68} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={243} y={0} w={34} h={34} color='#FA4EDF' opacity={0.6} />
      <Block x={243} y={0} w={17} h={17} color='#FA4EDF' />
      <Block x={260} y={0} w={34} h={17} color='#FA4EDF' opacity={0.6} />
      <Block x={261} y={17} w={17} h={17} color='#FA4EDF' />
    </div>
  )
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')

  if (!slug) {
    return new Response('Missing slug parameter', { status: 400 })
  }

  const post = await getPostMetaBySlug(slug)

  if (!post) {
    return new Response('Post not found', { status: 404 })
  }

  const category = getPrimaryCategory(post.tags)
  const authors = post.authors && post.authors.length > 0 ? post.authors : [post.author]
  const authorNames = authors.map((a) => a.name).join(', ')

  const allText = `${category.label}${post.readingTime ? `${post.readingTime} min read` : ''}${post.title}${post.description}${authorNames}${formatDate(new Date(post.date))}sim.ai/blog`
  const [fontData, logoDataUrl] = await Promise.all([
    loadGoogleFont('Inter', '400;500;700', allText),
    getLogoDataUrl(),
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
        background: '#1C1C1C',
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            'radial-gradient(circle at 2px 2px, rgba(255, 255, 255, 0.03) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          border: '1px solid #2A2A2A',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 502,
          display: 'flex',
          transform: 'rotate(90deg)',
        }}
      >
        <BlocksLeft />
      </div>

      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 212,
          display: 'flex',
        }}
      >
        <BlocksRight />
      </div>

      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          display: 'flex',
        }}
      >
        <BlocksTopRight />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 30, zIndex: 1 }}>
        <img src={logoDataUrl} alt='Sim' height={33} width={106.5} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 1,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 12px',
              backgroundColor: category.color,
              color: '#000000',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            {category.label}
          </div>
          {post.readingTime && (
            <span
              style={{
                fontSize: 13,
                color: '#666666',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 500,
              }}
            >
              {post.readingTime} min read
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: getTitleFontSize(post.title),
            fontWeight: 500,
            color: '#ECECEC',
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            maxWidth: '90%',
          }}
        >
          {post.title}
        </div>
        <div
          style={{
            fontSize: 18,
            color: '#999999',
            lineHeight: 1.5,
            maxWidth: '80%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {post.description.length > 140
            ? `${post.description.slice(0, 140)}...`
            : post.description}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 1,
          borderTop: '1px solid #2A2A2A',
          paddingTop: 30,
          marginBottom: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, color: '#999999', fontWeight: 500 }}>{authorNames}</span>
          <span
            style={{
              width: 4,
              height: 4,
              backgroundColor: '#3d3d3d',
              borderRadius: '50%',
            }}
          />
          <span style={{ fontSize: 14, color: '#666666', fontWeight: 500 }}>
            {formatDate(new Date(post.date))}
          </span>
        </div>
        <span
          style={{
            fontSize: 14,
            color: '#666666',
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}
        >
          sim.ai/blog
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
          style: 'normal' as const,
          weight: 500 as const,
        },
      ],
    }
  )
}
