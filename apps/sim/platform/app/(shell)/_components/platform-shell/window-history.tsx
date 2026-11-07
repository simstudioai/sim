'use client'

import { useSyncExternalStore } from 'react'
import { IconButton } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/_components/platform-shell/platform-shell.module.css'

interface WindowHistory extends EventTarget {
  canGoBack: boolean
  canGoForward: boolean
}

function historyState() {
  return (window as Window & { navigation?: WindowHistory }).navigation
}
function subscribe(listener: () => void) {
  const navigation = historyState()
  navigation?.addEventListener('currententrychange', listener)
  return () => navigation?.removeEventListener('currententrychange', listener)
}
const initial = () => false
const supportsBack = () => historyState()?.canGoBack ?? false
const supportsForward = () => historyState()?.canGoForward ?? false

export function WindowHistoryButtons() {
  const back = useSyncExternalStore(subscribe, supportsBack, initial)
  const forward = useSyncExternalStore(subscribe, supportsForward, initial)
  return (
    <>
      <IconButton label='Back' icon='I093' disabled={!back} onClick={() => window.history.back()} />
      <span className={styles.forward}>
        <IconButton
          label='Forward'
          icon='I093'
          disabled={!forward}
          onClick={() => window.history.forward()}
        />
      </span>
    </>
  )
}
