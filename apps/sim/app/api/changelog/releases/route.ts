import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'

const GITHUB_API_URL = 'https://api.github.com/repos/simstudioai/sim/releases'
const PER_PAGE = 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))

  try {
    const token = env.GITHUB_TOKEN
    const response = await fetch(`${GITHUB_API_URL}?per_page=${PER_PAGE}&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Sim/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `GitHub API returned ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    if (!Array.isArray(data)) {
      return NextResponse.json({ error: 'Unexpected response from GitHub API' }, { status: 502 })
    }

    const releases = data
      .filter((r: any) => !r.prerelease)
      .map((r: any) => ({
        tag: r.tag_name,
        title: r.name || r.tag_name,
        content: String(r.body || ''),
        date: r.published_at,
        url: r.html_url,
      }))

    return NextResponse.json({ releases })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch releases' }, { status: 500 })
  }
}
