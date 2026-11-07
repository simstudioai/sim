import { createContext } from 'react'

/** Where a page may place its title in the phone top bar. Empty, it draws nothing. */
export const MobileTitleSlot = createContext<HTMLElement | null>(null)
