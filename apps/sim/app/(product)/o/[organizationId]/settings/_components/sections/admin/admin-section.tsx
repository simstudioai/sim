import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { FixtureAdminPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/fixture-admin-panel'
import { LiveAdminPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/live-admin-panel'
import { loadAdminExample } from '@/platform/fixtures'
import { readScenario } from '@/platform/lib/navigation'

export default async function AdminSection({ organization, fixture, query }: SettingsSectionProps) {
  if (!organization.navFlags.platformAdmin) notFound()
  const example = fixture ? await loadAdminExample(readScenario(query.state)) : null
  if (example) return <FixtureAdminPanel example={example} />
  return <LiveAdminPanel benchmarkAvailable={organization.navFlags.benchmark} />
}
