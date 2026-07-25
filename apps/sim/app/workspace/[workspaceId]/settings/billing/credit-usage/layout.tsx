import {
  SettingsHeaderProvider,
  SettingsHeaderShell,
} from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'

/**
 * Credit usage is a static route outside `[section]`, so it does not inherit
 * `SettingsSectionLayout`'s chrome. `CreditUsageView` and its loading fallback
 * render through `SettingsPanel`, which only registers header config into the
 * `SettingsHeaderProvider` context — without this shell the page has no header
 * bar, title, or scroll region.
 */
export default function CreditUsageLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
