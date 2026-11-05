import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import {
  LinkRowsSkeleton,
  LinksFrame,
} from '@/platform/app/(shell)/_components/links-page/links-frame'

export default function SimLinksLoading() {
  return (
    <RedesignPageSurface>
      <LinksFrame loading>
        <LinkRowsSkeleton />
      </LinksFrame>
    </RedesignPageSurface>
  )
}
