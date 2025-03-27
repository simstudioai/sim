import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { imageUrl } = await request.json();

    if (!imageUrl) {
      return new NextResponse('Image URL is required', { status: 400 });
    }

    // Fetch the image from the DALL-E URL
    const response = await fetch(imageUrl, {
      headers: {
        'Accept': 'image/png,image/*;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch image');
    }

    // Get the image data
    const imageData = await response.arrayBuffer();

    // Return the image with appropriate headers
    return new NextResponse(imageData, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error downloading image:', error);
    return new NextResponse('Failed to download image', { status: 500 });
  }
} 