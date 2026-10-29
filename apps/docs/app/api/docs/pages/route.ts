import { listPages, listPagesSchema } from '@/lib/http/pages'

export function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const parsed = listPagesSchema.safeParse({
    section: params.get('section') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
  })
  if (!parsed.success) {
    return Response.json({ error: 'Invalid page discovery parameters' }, { status: 400 })
  }
  try {
    return Response.json(listPages(parsed.data), {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=3600' },
    })
  } catch {
    return Response.json({ error: 'Unknown page cursor' }, { status: 400 })
  }
}
