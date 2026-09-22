import { omit } from '@sim/utils/object'
import { createLoader, createSerializer } from 'nuqs/server'
import { accessReviewSearchParams } from '@/ee/access-requests/components/search-params'

const loadReviewSearchParams = createLoader(accessReviewSearchParams)
const serializeReviewSearchParams = createSerializer(
  omit(accessReviewSearchParams, ['access-view'])
)

/** Preserves review state when a saved Permission groups tab URL moves to Requests. */
export function getLegacyAccessRequestsQuery(
  section: string,
  searchParams: Record<string, string | string[] | undefined>
): URLSearchParams | null {
  if (section !== 'access-control') return null
  const params = loadReviewSearchParams(searchParams)
  return params['access-view'] === 'requests'
    ? new URLSearchParams(serializeReviewSearchParams(params))
    : null
}
