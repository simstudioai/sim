import { redirect } from 'next/navigation'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { RequestsPanel } from '@/platform/app/(shell)/settings/_components/sections/requests/requests-panel'
import { legacyRequestsQuery } from '@/platform/lib/data/legacy-request-link'

export default function RequestsSection({ organization, query }: SettingsSectionProps) {
  // `view=admin` is the legacy entry's spelling of the review view, still sent by older emails.
  if (query.view === 'admin') redirect(`/settings/requests${legacyRequestsQuery(query)}`)
  return <RequestsPanel organization={organization} />
}
