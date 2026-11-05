import { LandingSkeleton } from '@/platform/app/(shell)/_components/conversation/skeletons'

/** A route boundary cannot read `mode`, so it holds the Search view, where the route opens. */
export default function OrganizationSearchLoading() {
  return <LandingSkeleton field='search' />
}
