import type { ReactNode } from 'react'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface CredentialDetailHeadingProps {
  /** Leading visual (icon tile or brand tile). */
  leading: ReactNode
  title: ReactNode
  subtitle?: ReactNode
}

/**
 * Header row shared by credential detail surfaces. A thin alias over the static
 * {@link SettingsResourceRow} — the heading and the list row the user arrived
 * from are the same object, so they must not drift.
 */
export function CredentialDetailHeading({
  leading,
  title,
  subtitle,
}: CredentialDetailHeadingProps) {
  return (
    <SettingsResourceRow
      // A heading is not a list row: no bleed, no row padding.
      flush
      iconVariant='custom'
      icon={leading}
      title={title}
      // `''` rendered nothing before; the row only skips a nullish description.
      description={subtitle || undefined}
    />
  )
}
