'use client'

import { LinksPage } from '@/platform/app/(shell)/_components/links-page/links-page'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'

/** The zone serves Links under Settings; the page is the one the organization surface embeds. */
export default function LinksSection({ organization }: SettingsSectionProps) {
  return <LinksPage organizationId={organization.organization.id} />
}
