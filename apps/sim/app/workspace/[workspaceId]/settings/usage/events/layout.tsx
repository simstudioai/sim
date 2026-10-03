import {
  SettingsHeaderProvider,
  SettingsHeaderShell,
} from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'

/**
 * Usage events is a static route outside `[section]`, so it inherits none of
 * `SettingsSectionLayout`'s chrome. Its body renders through `SettingsPanel`, which
 * only registers header config into `SettingsHeaderProvider` — without this shell the
 * page would have no header bar, title, or scroll region.
 */
export default function UsageEventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
