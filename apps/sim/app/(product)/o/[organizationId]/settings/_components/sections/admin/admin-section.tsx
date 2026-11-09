import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { AdminPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/admin-panel'
import { loadAdminExample } from '@/platform/fixtures'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readScenario } from '@/platform/lib/navigation'

export default async function AdminSection({ organization, fixture, query }: SettingsSectionProps) {
  if (!organization.navFlags.platformAdmin) notFound()
  const example = fixture ? await loadAdminExample(readScenario(query.state)) : null
  const preferences =
    example ??
    (await import('@/platform/lib/data/admin').then(({ readAdminPreferences }) =>
      readAdminPreferences().catch(() => null)
    ))
  return (
    <AdminPanel
      preferences={preferences}
      example={example}
      benchmarkAvailable={example ? true : organization.navFlags.benchmark}
      benchmarkHref='/benchmark'
      manageHref={surfaceHref(organization, '/settings/admin')}
    />
  )
}
