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
    <SettingsResourceRow iconVariant='custom' icon={leading} title={title} description={subtitle} />
  )
}
