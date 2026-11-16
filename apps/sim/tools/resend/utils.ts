import type { ResendPaginationParams } from '@/tools/resend/types'

/**
 * Appends Resend's `limit` and `after` cursor query params to a list URL, leaving it bare when
 * neither is set so an unpaginated call sends the same request as before.
 */
export function withPagination(url: string, params: ResendPaginationParams): string {
  const query = new URLSearchParams()
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    query.set('limit', String(params.limit))
  }
  const after = typeof params.after === 'string' ? params.after.trim() : ''
  if (after) query.set('after', after)
  const search = query.toString()
  return search ? `${url}?${search}` : url
}
