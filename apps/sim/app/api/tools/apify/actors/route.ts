import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get('apiKey')

  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey required' }, { status: 400 })
  }

  try {
    const response = await fetch('https://api.apify.com/v2/acts?my=1&limit=100', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch actors' },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Format for dropdown: { label, value }
    const actors = data.data.items.map((actor: any) => ({
      id: actor.id,
      name: actor.name,
      username: actor.username,
      label: `${actor.username}/${actor.name}`,
      value: actor.id,
      description: actor.description,
    }))

    return NextResponse.json({ actors })
  } catch (error) {
    console.error('Error fetching APIFY actors:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
