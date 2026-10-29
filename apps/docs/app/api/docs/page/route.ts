import { pagePathSchema, readPage } from '@/lib/http/pages'

export function GET(request: Request) {
  const parsed = pagePathSchema.safeParse(new URL(request.url).searchParams.get('path'))
  if (!parsed.success) {
    return Response.json({ error: 'A canonical documentation path is required' }, { status: 400 })
  }
  const page = readPage(parsed.data)
  if (!page) return Response.json({ error: 'Page not found' }, { status: 404 })
  return Response.json(
    { page },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=3600' } }
  )
}
