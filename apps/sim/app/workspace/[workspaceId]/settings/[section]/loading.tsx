import { SettingsSectionSkeleton } from '@/components/settings/settings-section-skeleton'

/**
 * Route-transition fallback for every settings section.
 *
 * Without a loading boundary the App Router holds the outgoing section on screen until the
 * incoming page's access gate resolves, so a click reads as a dead click. This commits the
 * navigation immediately and lets the gate resolve behind it.
 */
export default function SettingsSectionLoading() {
  return <SettingsSectionSkeleton />
}
