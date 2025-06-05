import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Get template data from query parameters
    const templateData = {
      name: searchParams.get('name') || 'Template',
      authorName: searchParams.get('authorName') || 'Sim Studio',
      category: searchParams.get('category') || 'template',
      views: Number.parseInt(searchParams.get('views') || '0'),
    }

    return new ImageResponse(
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          backgroundImage: 'linear-gradient(45deg, #f8fafc 0%, #e2e8f0 100%)',
          position: 'relative',
        }}
      >
        {/* Sim Studio Logo and Branding */}
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 40,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* Sim Studio Logo - Using a simple geometric shape as placeholder */}
          <div
            style={{
              width: 40,
              height: 40,
              backgroundColor: '#3972F6',
              borderRadius: 8,
              marginRight: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                backgroundColor: 'white',
                borderRadius: 4,
              }}
            />
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: '#1e293b',
              fontFamily: 'Inter',
            }}
          >
            Sim Studio
          </div>
        </div>

        {/* Main Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: 800,
            padding: '0 40px',
          }}
        >
          {/* Template Name */}
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: '#1e293b',
              marginBottom: 20,
              fontFamily: 'Inter',
              lineHeight: 1.1,
            }}
          >
            {templateData.name}
          </div>

          {/* Template Description */}
          <div
            style={{
              fontSize: 32,
              color: '#64748b',
              marginBottom: 40,
              fontFamily: 'Inter',
              fontWeight: 400,
            }}
          >
            Template by {templateData.authorName}
          </div>
        </div>

        {/* Stats Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 18,
              color: '#64748b',
              fontFamily: 'Inter',
            }}
          >
            👁️ {templateData.views.toLocaleString()} views
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 18,
              color: '#64748b',
              fontFamily: 'Inter',
              textTransform: 'capitalize',
            }}
          >
            📂 {templateData.category}
          </div>
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
      }
    )
  } catch (error) {
    console.error('Error generating OG image:', error)

    // Return a simple fallback image
    return new ImageResponse(
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#3972F6',
          color: 'white',
        }}
      >
        <div style={{ fontSize: 60, fontWeight: 'bold' }}>Sim Studio</div>
        <div style={{ fontSize: 30, marginTop: 20 }}>Template</div>
      </div>,
      {
        width: 1200,
        height: 630,
      }
    )
  }
}
