import type { ReactNode } from 'react'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface DetailSectionProps {
  title: ReactNode
  children: ReactNode
}

/**
 * Labeled section for the credential detail surfaces. A thin alias over the
 * shared {@link SettingsSection} so credential pages and settings pages cannot
 * drift apart; kept for its `title` naming at the existing callsites.
 */
export function DetailSection({ title, children }: DetailSectionProps) {
  return <SettingsSection label={title}>{children}</SettingsSection>
}
