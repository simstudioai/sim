'use client'

import { SegmentedControl } from '@sim/emcn/segmented-control'
import { MyRequests } from '@/app/(product)/_components/access-requests/my-requests'
import { ReviewRequests } from '@/app/(product)/_components/access-requests/review-requests'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { type RequestScope, useMyRequests, useRequestsUrl } from '@/platform/lib/data/requests'

interface RequestsPanelProps {
  /** Where the viewer's own requests are filed: the organization, or one of its workspaces. */
  scope: RequestScope
  /** The organization whose requests the viewer reviews; absent for a viewer who reviews none. */
  reviewOrganizationId?: string
}

/** Every member sees their own requests; the review view exists only for administrators. */
export function RequestsPanel({ scope, reviewOrganizationId }: RequestsPanelProps) {
  const canReview = Boolean(reviewOrganizationId)
  const { setParams, view } = useRequestsUrl(canReview)
  const mine = useMyRequests(scope, view)
  const showCatalog = view === 'catalog' || mine.showCatalog
  return (
    <SectionStack>
      {(showCatalog || canReview) && (
        <SegmentedControl
          label='Access request views'
          options={[
            { value: 'requests', label: 'My requests' },
            ...(showCatalog ? [{ value: 'catalog' as const, label: 'Browse access' }] : []),
            ...(canReview ? [{ value: 'review' as const, label: 'Review requests' }] : []),
          ]}
          value={view}
          onSelect={(next) =>
            void setParams({ view: next, page: 0, requestId: null, 'request-id': null })
          }
        />
      )}
      {view === 'review' ? (
        reviewOrganizationId && <ReviewRequests organizationId={reviewOrganizationId} />
      ) : (
        <MyRequests scope={scope} view={view} mine={mine} />
      )}
    </SectionStack>
  )
}
