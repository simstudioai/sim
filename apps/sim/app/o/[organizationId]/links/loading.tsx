import { LinksFrame } from '@/platform/app/(shell)/links/_components/links-page/links-frame'
import { LoadingRows } from '@/platform/design-system/components/status/query-boundary'
import { PageSurface } from '@/platform/design-system/components/surface/surface'

export default function SimLinksLoading() {
  return (
    <PageSurface>
      <LinksFrame loading>
        <LoadingRows label='Loading links' rows={6} />
      </LinksFrame>
    </PageSurface>
  )
}
