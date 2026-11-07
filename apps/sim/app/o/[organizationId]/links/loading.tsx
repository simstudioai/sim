import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { PageSurface } from '@sim/emcn-platform/surface'
import { LinksFrame } from '@/platform/embedded/app/(shell)/links/_components/links-page/links-frame'

export default function SimLinksLoading() {
  return (
    <PageSurface>
      <LinksFrame loading>
        <LoadingRows label='Loading links' rows={6} />
      </LinksFrame>
    </PageSurface>
  )
}
