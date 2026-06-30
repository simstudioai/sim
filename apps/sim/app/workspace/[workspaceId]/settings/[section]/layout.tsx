import {
  SettingsHeaderProvider,
  SettingsHeaderShell,
} from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'

/**
 * Persistent chrome for the settings panel pages. The header bar, title,
 * description, scroll region, and centered column live in the shell and stay
 * mounted across section navigation — only the body swaps. Scoped to `[section]`
 * so detail routes (e.g. `secrets/[credentialId]`) keep their own chrome.
 */
export default function SettingsSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
