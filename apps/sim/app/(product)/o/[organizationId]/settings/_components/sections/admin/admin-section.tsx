import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { LiveAdminPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/live-admin-panel'
import { readScenario } from '@/platform/lib/navigation'

export default async function AdminSection({ organization, query }: SettingsSectionProps) {
  if (!organization.navFlags.platformAdmin) notFound()
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ FixtureAdminPanel }, { loadAdminExample }] = await Promise.all([
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/fixture-admin-panel'
      ),
      import('@/platform/fixtures'),
    ])
    const example = await loadAdminExample(readScenario(query.state))
    return <FixtureAdminPanel example={example} />
  }
  return <LiveAdminPanel benchmarkAvailable={organization.navFlags.benchmark} />
}
