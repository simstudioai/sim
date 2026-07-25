'use client'

import { createContext, type ReactNode, type Ref, useContext } from 'react'
import { getSettingsSectionMeta, type SettingsPlane } from '@/components/settings/navigation'
import {
  type SettingsAction,
  type SettingsBackAction,
  type SettingsHeaderSearch,
  useSettingsHeader,
} from '@/components/settings/settings-header'

interface SettingsSectionContextValue {
  plane?: SettingsPlane
  section: string
  meta?: {
    label: string
    description: string
    docsLink?: string
  }
}

const SettingsSectionContext = createContext<SettingsSectionContextValue | null>(null)

interface SettingsSectionProviderProps extends SettingsSectionContextValue {
  children: ReactNode
}

export function SettingsSectionProvider({
  plane,
  section,
  meta,
  children,
}: SettingsSectionProviderProps) {
  return (
    <SettingsSectionContext.Provider value={{ plane, section, meta }}>
      {children}
    </SettingsSectionContext.Provider>
  )
}

interface SettingsPanelProps {
  children?: ReactNode
  actions?: SettingsAction[]
  back?: SettingsBackAction
  search?: SettingsHeaderSearch
  title?: string
  description?: string
  docsLink?: string
  scrollContainerRef?: Ref<HTMLDivElement>
}

export function SettingsPanel({
  children,
  actions,
  back,
  search,
  title,
  description,
  docsLink,
  scrollContainerRef,
}: SettingsPanelProps) {
  const context = useContext(SettingsSectionContext)
  const meta =
    context?.meta ??
    (context?.plane ? getSettingsSectionMeta(context.plane, context.section) : null)

  useSettingsHeader({
    title: title ?? meta?.label,
    description: title !== undefined ? description : (description ?? meta?.description),
    docsLink: docsLink ?? meta?.docsLink,
    back,
    actions,
    search,
    scrollContainerRef,
  })

  return <>{children}</>
}
