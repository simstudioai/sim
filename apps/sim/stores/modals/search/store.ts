import { create } from 'zustand'
import type { SearchModalState } from './types'

export const useSearchModalStore = create<SearchModalState>((set) => ({
  isOpen: false,
  setOpen: (open: boolean) => {
    set({ isOpen: open })
  },
  open: () => {
    set({ isOpen: true })
  },
  close: () => {
    set({ isOpen: false })
  },
}))
