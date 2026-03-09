'use client'

import { create } from 'zustand'
import type { SettingsModalState } from './types'

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  initialSection: null,
  mcpServerId: null,
  hasUnsavedChanges: false,
  onCloseAttempt: null,

  openModal: (options) =>
    set({
      isOpen: true,
      initialSection: options?.section || null,
      mcpServerId: options?.mcpServerId || null,
    }),

  closeModal: () =>
    set({
      isOpen: false,
      hasUnsavedChanges: false,
      onCloseAttempt: null,
    }),

  clearInitialState: () =>
    set({
      initialSection: null,
      mcpServerId: null,
    }),

  setHasUnsavedChanges: (hasChanges) =>
    set({
      hasUnsavedChanges: hasChanges,
    }),

  setOnCloseAttempt: (callback) =>
    set({
      onCloseAttempt: callback,
    }),
}))
