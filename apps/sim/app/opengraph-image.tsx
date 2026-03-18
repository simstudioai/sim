import fs from 'fs/promises'
import path from 'path'
import { ImageResponse } from 'next/og'

export const alt = 'Sim — Build AI Agents & Run Your Agentic Workforce'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const COLORS = ['#2ABBF8', '#FA4EDF', '#FFCC02', '#00F701'] as const

async function loadFonts() {
  const fontsDirPrimary = path.join(process.cwd(), 'app', '_styles', 'fonts', 'season')
  const fontsDirFallback = path.join(
    process.cwd(),
    'apps',
    'sim',
    'app',
    '_styles',
    'fonts',
    'season'
  )

  let fontsDir = fontsDirPrimary
  try {
    await fs.access(fontsDirPrimary)
  } catch {
    fontsDir = fontsDirFallback
  }

  const [fontMedium, fontBold] = await Promise.all([
    fs.readFile(path.join(fontsDir, 'SeasonSans-Medium.woff')),
    fs.readFile(path.join(fontsDir, 'SeasonSans-Medium.woff')),
  ])

  return { fontMedium, fontBold }
}

export default async function OgImage() {
  let fontMedium: Buffer
  let fontBold: Buffer
  try {
    const fonts = await loadFonts()
    fontMedium = fonts.fontMedium
    fontBold = fonts.fontBold
  } catch {
    return new Response('Font assets not found', { status: 500 })
  }

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '64px 80px',
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
            <div key={color} style={{ width: 20, height: 20, backgroundColor: color }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {COLORS.slice(0, 3).map((color) => (
            <div key={`v-${color}`} style={{ width: 20, height: 20, backgroundColor: color }} />
          ))}
        </div>
      </div>

      {/* Bottom-right colored blocks */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          bottom: 0,
          right: 0,
          alignItems: 'flex-end',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {COLORS.slice(0, 3)
            .reverse()
            .map((color) => (
              <div key={`vb-${color}`} style={{ width: 20, height: 20, backgroundColor: color }} />
            ))}
        </div>
        <div style={{ display: 'flex' }}>
          {[...COLORS].reverse().map((color) => (
            <div key={`b-${color}`} style={{ width: 20, height: 20, backgroundColor: color }} />
          ))}
        </div>
      </div>

      {/* Top-right accent blocks */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          right: 80,
          gap: 0,
        }}
      >
        <div style={{ width: 20, height: 20, backgroundColor: '#2ABBF8', opacity: 0.6 }} />
        <div style={{ width: 20, height: 20, backgroundColor: '#FA4EDF' }} />
        <div style={{ width: 20, height: 20, backgroundColor: '#00F701', opacity: 0.6 }} />
      </div>

      {/* Bottom-left accent blocks */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: 0,
          left: 80,
          gap: 0,
        }}
      >
        <div style={{ width: 20, height: 20, backgroundColor: '#00F701', opacity: 0.6 }} />
        <div style={{ width: 20, height: 20, backgroundColor: '#FFCC02' }} />
        <div style={{ width: 20, height: 20, backgroundColor: '#2ABBF8', opacity: 0.6 }} />
      </div>

      {/* Logo mark (green Sim icon) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 32,
          zIndex: 1,
        }}
      >
        <svg width='48' height='48' viewBox='0 0 294 294' fill='none'>
          <path
            fillRule='evenodd'
            clipRule='evenodd'
            d='M142.793 124.175C142.793 128.925 140.913 133.487 137.577 136.846L137.099 137.327C133.765 140.696 129.236 142.579 124.519 142.579H17.8063C7.97854 142.579 0 150.605 0 160.503V275.91C0 285.808 7.97854 293.834 17.8063 293.834H132.383C142.211 293.834 150.179 285.808 150.179 275.91V167.858C150.179 163.453 151.914 159.226 155.009 156.109C158.095 153.001 162.292 151.253 166.666 151.253H275.166C284.994 151.253 292.962 143.229 292.962 133.33V17.9231C292.962 8.02512 284.994 0 275.166 0H160.588C150.761 0 142.793 8.02512 142.793 17.9231V124.175ZM177.564 24.5671H258.181C263.925 24.5671 268.57 29.2545 268.57 35.0301V116.224C268.57 121.998 263.925 126.687 258.181 126.687H177.564C171.83 126.687 167.175 121.998 167.175 116.224V35.0301C167.175 29.2545 171.83 24.5671 177.564 24.5671Z'
            fill='#33C482'
          />
          <path
            d='M275.293 171.578H190.106C179.779 171.578 171.406 180.01 171.406 190.412V275.162C171.406 285.564 179.779 293.996 190.106 293.996H275.293C285.621 293.996 293.994 285.564 293.994 275.162V190.412C293.994 180.01 285.621 171.578 275.293 171.578Z'
            fill='#33C482'
          />
          <path
            d='M275.293 171.18H190.106C179.779 171.18 171.406 179.612 171.406 190.014V274.763C171.406 285.165 179.779 293.596 190.106 293.596H275.293C285.621 293.596 293.994 285.165 293.994 274.763V190.014C293.994 179.612 285.621 171.18 275.293 171.18Z'
            fill='#33C482'
            fillOpacity='0.2'
          />
        </svg>
      </div>

      {/* Main heading */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 500,
            color: '#FFFFFF',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            textAlign: 'center',
          }}
        >
          Build AI Agents
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: 'rgba(246, 246, 246, 0.6)',
            lineHeight: 1.3,
            letterSpacing: '0.02em',
            textAlign: 'center',
          }}
        >
          Sim is the AI Workspace for Agent Builders.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 40,
          zIndex: 1,
        }}
      >
        {[
          { label: '1,000+ Integrations', color: '#2ABBF8' },
          { label: 'Open Source', color: '#00F701' },
          { label: 'SOC 2 & HIPAA', color: '#FFCC02' },
          { label: 'Enterprise Ready', color: '#FA4EDF' },
        ].map((pill) => (
          <div
            key={pill.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              border: '1px solid #2A2A2A',
              backgroundColor: '#232323',
              fontSize: 13,
              fontWeight: 500,
              color: '#999999',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                backgroundColor: pill.color,
                flexShrink: 0,
              }}
            />
            {pill.label}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 24,
          position: 'absolute',
          bottom: 40,
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: 30,
            color: '#666666',
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}
        >
          sim.ai
        </span>
      </div>
    </div>,
    {
      ...size,
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
