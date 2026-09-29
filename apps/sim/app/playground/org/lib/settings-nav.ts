import type { ComponentType } from 'react'
import { SlidersHorizontal } from '@sim/emcn/icons'
import { WORKSPACE_SETTINGS_ITEMS } from '@/components/settings/navigation'

type Icon = ComponentType<{ className?: string }>

export interface SettingsNavItem {
  id: string
  label: string
  description: string
  icon: Icon
  group: string
}

export const SETTINGS_GROUP_TITLES: Record<string, string> = {
  project: 'Project',
  workspace: 'Workspace',
  tools: 'Tools',
  system: 'System',
  enterprise: 'Enterprise',
}

/** Prod's workspace settings catalog, plus a Project group for the tracker and feedback loop. */
export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: 'project',
    label: 'General',
    description: 'Tracker, feedback sources, and how Sim triages and replies.',
    icon: SlidersHorizontal,
    group: 'project',
  },
  ...WORKSPACE_SETTINGS_ITEMS.filter((item) => item.id !== 'self-host').map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    icon: item.icon,
    group: item.group,
  })),
]
export const SETTINGS_GROUPS = [...new Set(SETTINGS_NAV.map((item) => item.group))]

export const DEFAULT_SETTINGS_SECTION = 'project'
