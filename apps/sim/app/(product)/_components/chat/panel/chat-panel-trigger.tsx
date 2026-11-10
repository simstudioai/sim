'use client'

import { createContext, useContext } from 'react'
import { IconButton } from '@sim/emcn/button'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'

/** Opens the chat panel from the control pressed; absent while the surface holds the panel back. */
export const OpenPanel = createContext<((element: HTMLButtonElement) => void) | null>(null)

/** The control that opens the chat panel, absent while the surface holds the panel back. */
export function ChatPanelTrigger() {
  const open = useContext(OpenPanel)
  if (!open) return null
  return (
    <span className={styles.openTrigger}>
      <IconButton
        icon='I038'
        label='Open chat panel'
        onClick={(event) => open(event.currentTarget)}
      />
    </span>
  )
}
