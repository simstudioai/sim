'use client'

import { MyRequests } from '@/platform/app/(shell)/settings/_components/sections/requests/my-requests'
import styles from '@/platform/app/(shell)/settings/_components/sections/requests/requests.module.css'
import { ReviewRequests } from '@/platform/app/(shell)/settings/_components/sections/requests/review-requests'
import { SegmentedControl } from '@/platform/design-system/components'
import type { PlatformOrganization } from '@/platform/lib/data/organization'
import { type RequestScope, useMyRequests, useRequestsUrl } from '@/platform/lib/data/requests'

interface RequestsPanelProps {
  organization: PlatformOrganization
}

/** Every member sees their own requests; the review view exists only for administrators. */
export function RequestsPanel({ organization }: RequestsPanelProps) {
  const canReview = organization.viewer.isAdmin
  const { setParams, view } = useRequestsUrl(canReview)
  const scope: RequestScope = { kind: 'organization', organizationId: organization.organization.id }
  const mine = useMyRequests(scope, view)
  const showCatalog = view === 'catalog' || mine.showCatalog
  return (
    <div className={styles.panel}>
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
        <ReviewRequests organizationId={organization.organization.id} />
      ) : (
        <MyRequests scope={scope} view={view} mine={mine} />
      )}
    </div>
  )
}
