import { listPages, listPagesSchema, UnknownPageCursorError } from '@/lib/http/pages'

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
  } catch (error) {
    if (error instanceof UnknownPageCursorError)
      return Response.json({ error: error.message }, { status: 400 })
    throw error
  }
}
