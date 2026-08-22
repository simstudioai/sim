import {
  SettingsHeaderProvider,
  SettingsHeaderShell,
} from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { resolveSettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

/**
 * Persistent chrome for the settings panel pages. The header bar, title,
 * description, scroll region, and centered column live in the shell and stay
 * mounted across section navigation — only the body swaps. Scoped to `[section]`
 * so detail routes (e.g. `secrets/[credentialId]`) keep their own chrome.
 *
 * The heading is resolved here rather than pushed up from the section body, so it
 * paints with the shell instead of waiting on the body's lazily-loaded chunk. An
 * unknown segment resolves to `null` and the page below it calls `notFound()`.
 */
export default async function SettingsSectionLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  const meta = resolveSettingsSection(section)?.meta ?? null

  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={meta}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
