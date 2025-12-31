'use client'

import { create } from 'zustand'

type SettingsSection =
  | 'general'
  | 'environment'
  | 'template-profile'
  | 'integrations'
  | 'apikeys'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'workflow-mcp-servers'

interface SettingsModalState {
  isOpen: boolean
  initialSection: SettingsSection | null
  mcpServerId: string | null

  openModal: (options?: { section?: SettingsSection; mcpServerId?: string }) => void
  closeModal: () => void
  clearInitialState: () => void
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  initialSection: null,
  mcpServerId: null,

  openModal: (options) =>
    set({
      isOpen: true,
      initialSection: options?.section || null,
      mcpServerId: options?.mcpServerId || null,
    }),

  closeModal: () =>
    set({
      isOpen: false,
    }),

  clearInitialState: () =>
    set({
      initialSection: null,
      mcpServerId: null,
    }),
}))
