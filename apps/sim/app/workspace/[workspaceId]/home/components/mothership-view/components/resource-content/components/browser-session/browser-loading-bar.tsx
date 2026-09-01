'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import styles from './browser-loading-bar.module.css'

const COMPLETION_DURATION_MS = 200

type LoadingBarPhase = 'hidden' | 'loading' | 'completing'

/**
 * Browser-style progress without fabricated percentages: it trickles below
 * completion while navigation is active, then visibly reaches the right edge
 * and fades only after Electron reports the page settled.
 */
export function BrowserLoadingBar({ loading }: { loading: boolean }) {
  const [phase, setPhase] = useState<LoadingBarPhase>(loading ? 'loading' : 'hidden')

  useEffect(() => {
    if (loading) {
      setPhase('loading')
      return
    }
    setPhase((current) => (current === 'hidden' ? current : 'completing'))
  }, [loading])

  useEffect(() => {
    if (phase !== 'completing') return
    const timeout = setTimeout(() => setPhase('hidden'), COMPLETION_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [phase])

  if (phase === 'hidden') return null

  return (
    <div
      role='progressbar'
      aria-label='Page loading'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={phase === 'completing' ? 100 : undefined}
      aria-valuetext={phase === 'completing' ? 'Page loaded' : 'Loading page'}
      className={cn(styles.track, phase === 'completing' && styles.completing)}
      data-phase={phase}
    >
      <span className={styles.indicator} />
    </div>
  )
}
