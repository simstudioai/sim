'use client'

import { Chip, ChipSelect } from '@sim/emcn'
import { ChevronLeft } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import type { SettingsNavigationItem, SettingsSection } from '@/components/settings/navigation'
import { usePendingSettingsSelection } from '@/components/settings/use-pending-settings-selection'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { popSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface SettingsMobileNavigationProps<Section extends SettingsSection> {
  activeSection: Section
  items: readonly SettingsNavigationItem<Section>[]
  hrefForSection: (section: Section) => string
}

export function SettingsMobileNavigation<Section extends SettingsSection>({
  activeSection,
  items,
  hrefForSection,
}: SettingsMobileNavigationProps<Section>) {
  const router = useRouter()
  const { activeSection: selectedSection, navigateToSection } =
    usePendingSettingsSelection(activeSection)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)

  return (
    <nav
      aria-label='Settings navigation'
      className='flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2 md:hidden'
    >
      <Chip
        leftIcon={ChevronLeft}
        onClick={() => requestLeave(() => router.push(popSettingsReturnUrl(APP_ENTRY_PATH)))}
      >
        Back
      </Chip>
      <ChipSelect
        aria-label='Settings section'
        value={selectedSection}
        options={items.map((item) => ({ value: item.id, label: item.label, icon: item.icon }))}
        onChange={(value) => {
          const item = items.find((candidate) => candidate.id === value)
          if (!item || item.id === selectedSection) return
          requestLeave(() => navigateToSection(item.id, hrefForSection(item.id)))
        }}
        align='end'
        modal={false}
        searchable
        className='min-w-0 max-w-full'
      />
    </nav>
  )
}
