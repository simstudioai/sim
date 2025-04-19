import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ProxyImage')

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')

    if (!imageUrl) {
      logger.error('Missing URL parameter in proxy image request')
      return new NextResponse('Missing URL parameter', { status: 400 })
    }

    logger.info('Proxying image from:', imageUrl)

    // Add appropriate headers for fetching images
    const response = await fetch(imageUrl, {
      headers: {
        Accept: 'image/*, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; ImageProxyBot/1.0)',
      },
      // Set a reasonable timeout
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      console.error(`Failed to fetch image from ${imageUrl}:`, response.status, response.statusText)
      return new NextResponse(`Failed to fetch image: ${response.status} ${response.statusText}`, {
        status: response.status,
      })
    }

    const contentType = response.headers.get('content-type')
    console.log('Image content-type:', contentType)

    const blob = await response.blob()
    console.log('Image size:', blob.size, 'bytes')

    if (blob.size === 0) {
      console.error('Empty image received from source URL')
      return new NextResponse('Empty image received from source', { status: 422 })
    }

    // Return the image with appropriate headers
    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType || 'image/png',
        'Cache-Control': 'public, max-age=31536000', // Cache for a year
        'Access-Control-Allow-Origin': '*', // CORS support
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    // Log the full error for debugging
    console.error('Error proxying image:', error)

    // Return a helpful error response
    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    )
  }
}
