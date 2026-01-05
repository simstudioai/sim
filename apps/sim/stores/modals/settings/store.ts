'use client'

import { create } from 'zustand'
import type { SettingsModalState } from './types'

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
