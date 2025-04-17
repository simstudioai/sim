import { NextRequest, NextResponse } from 'next/server';

/**
 * Direct HTTP request handler that fetches external URLs server-side
 * This avoids CORS and other browser restrictions
 */
export async function GET(request: NextRequest) {
  // Get URL from query parameter
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  
  if (!url) {
    return NextResponse.json(
      { error: 'Missing URL parameter' },
      { status: 400 }
    );
  }

  try {
    // Direct fetch from server side
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

    // Get the response data
    const contentType = response.headers.get('content-type') || '';
    let data;
    
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Return full response information
    return NextResponse.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch URL' },
      { status: 500 }
    );
  }
} 