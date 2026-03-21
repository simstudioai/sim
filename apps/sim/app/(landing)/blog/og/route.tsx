import fs from 'fs/promises'
import path from 'path'
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { getPostBySlug } from '@/lib/blog/registry'
import { getPrimaryCategory } from '@/app/(landing)/studio/tag-colors'

export const revalidate = 3600

function getTitleFontSize(title: string): number {
  if (title.length > 80) return 36
  if (title.length > 60) return 40
  if (title.length > 40) return 48
  return 56
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')

  if (!slug) {
    return new Response('Missing slug parameter', { status: 400 })
  }

  let post
  try {
    post = await getPostBySlug(slug)
  } catch {
    return new Response('Post not found', { status: 404 })
  }

  const category = getPrimaryCategory(post.tags)
  const authors = post.authors && post.authors.length > 0 ? post.authors : [post.author]
  const authorNames = authors.map((a) => a.name).join(', ')

  let fontMedium: Buffer
  let fontBold: Buffer
  try {
    const fontsDir = path.join(process.cwd(), 'app', '_styles', 'fonts', 'season')
    ;[fontMedium, fontBold] = await Promise.all([
      fs.readFile(path.join(fontsDir, 'SeasonSans-Medium.woff')),
      fs.readFile(path.join(fontsDir, 'SeasonSans-Bold.woff')),
    ])
  } catch {
    return new Response('Font assets not found', { status: 500 })
  }

  const COLORS = ['#2ABBF8', '#FA4EDF', '#FFCC02', '#00F701'] as const

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
        fontFamily: 'Season Sans',
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
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        <div style={{ display: 'flex' }}>
          {COLORS.map((color) => (
            <div key={color} style={{ width: 16, height: 16, backgroundColor: color }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {COLORS.slice(0, 3).map((color) => (
            <div key={`v-${color}`} style={{ width: 16, height: 16, backgroundColor: color }} />
          ))}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: 0,
          right: 0,
        }}
      >
        {[...COLORS].reverse().map((color) => (
          <div key={`b-${color}`} style={{ width: 16, height: 16, backgroundColor: color }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, zIndex: 1 }}>
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
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          zIndex: 1,
          flex: 1,
          justifyContent: 'center',
        }}
      >
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
          paddingTop: 24,
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
            {formatDate(post.date)}
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
          sim.ai/studio
        </span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Season Sans',
          data: fontMedium,
          style: 'normal' as const,
          weight: 500 as const,
        },
        {
          name: 'Season Sans',
          data: fontBold,
          style: 'normal' as const,
          weight: 700 as const,
        },
      ],
    }
  )
}
