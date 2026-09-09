'use client'

import { Code, CopyCodeButton } from '@sim/emcn'

interface SlackAppManifestProps {
  manifest: string
}

/** Shared manifest preview for Slack app setup flows. */
export function SlackAppManifest({ manifest }: SlackAppManifestProps) {
  return (
    <div className='overflow-hidden rounded-md border border-[var(--border)]'>
      <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-4)] px-3 py-1'>
        <span className='font-sans text-[var(--text-tertiary)] text-xs'>manifest.json</span>
        <CopyCodeButton code={manifest} />
      </div>
      <Code.Viewer code={manifest} language='json' wrapText className='max-h-[180px]' />
    </div>
  )
}
