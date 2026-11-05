import { HomeDashboardSkeleton } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'

/** A route boundary cannot know the viewer's mode, so it holds the Assistant's, the common one. */
export default function OrganizationHomeLoading() {
  return <HomeDashboardSkeleton requestMode='assistant' />
}
