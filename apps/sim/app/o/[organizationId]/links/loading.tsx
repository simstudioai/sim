import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { LinksFrame } from '@/platform/app/(shell)/links/_components/links-page/links-frame'
import { LoadingRows } from '@/platform/design-system/components/status/query-boundary'

export default function SimLinksLoading() {
  return (
    <RedesignPageSurface>
      <LinksFrame loading>
        <LoadingRows label='Loading links' rows={6} />
      </LinksFrame>
    </RedesignPageSurface>
  )
}
