import type { ResendPaginationParams } from '@/tools/resend/types'

/**
 * Appends Resend's `limit` and `after` cursor query params to a list URL, leaving it bare when
 * neither is set so an unpaginated call sends the same request as before. `limit` is clamped to
 * the 1-100 page size Resend accepts.
 */
export function withPagination(url: string, params: ResendPaginationParams): string {
  const query = new URLSearchParams()
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    query.set('limit', String(Math.min(Math.max(1, Math.trunc(params.limit)), 100)))
  }
  const after = typeof params.after === 'string' ? params.after.trim() : ''
  if (after) query.set('after', after)
  const search = query.toString()
  return search ? `${url}?${search}` : url
}
