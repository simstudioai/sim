'use client'

import { useSettingsNavigationState } from '@/components/settings/settings-navigation-provider'

/**
 * The sidebar's selected row: the section a click is navigating to until that navigation settles
 * (see `SettingsNavigationProvider`), otherwise the section the route resolved to.
 */
export function usePendingSettingsSelection<TSection extends string>(
  routeSection: TSection
): { activeSection: TSection; navigateToSection: (section: TSection, href: string) => void } {
  const { pendingSection, navigateToSection } = useSettingsNavigationState()
  return {
    activeSection: (pendingSection as TSection | null) ?? routeSection,
    // Returning to the section already on screen previews nothing: its content is what will show.
    navigateToSection: (section, href) =>
      navigateToSection(section === routeSection ? null : section, href),
  }
}
