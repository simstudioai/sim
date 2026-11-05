import { LinksSurface } from '@/app/o/[organizationId]/links/links-surface'
import {
  LinkRowsSkeleton,
  LinksFrame,
} from '@/platform/app/(shell)/_components/links-page/links-frame'

export default function SimLinksLoading() {
  return (
    <LinksSurface>
      <LinksFrame loading>
        <LinkRowsSkeleton />
      </LinksFrame>
    </LinksSurface>
  )
}
