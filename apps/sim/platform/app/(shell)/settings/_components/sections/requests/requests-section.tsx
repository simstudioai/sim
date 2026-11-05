import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { RequestsPanel } from '@/platform/app/(shell)/settings/_components/sections/requests/requests-panel'

export default function RequestsSection({ organization }: SettingsSectionProps) {
  return <RequestsPanel organization={organization} />
}
