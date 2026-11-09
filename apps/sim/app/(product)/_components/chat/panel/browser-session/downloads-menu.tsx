'use client'

import { useRef } from 'react'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import styles from '@/app/(product)/_components/chat/panel/browser-session/browser-session.module.css'
import type { useBrowserPanel } from '@/platform/lib/data/browser-panel'

type Downloads = NonNullable<ReturnType<typeof useBrowserPanel>['downloads']>

interface DownloadsMenuProps {
  downloads: Downloads
}

/**
 * The toolbar's recent downloads: activity on the button, and a list where a finished download
 * reveals itself in the file manager.
 */
export function DownloadsMenu({ downloads }: DownloadsMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const { inProgress, percent } = downloads
  return (
    <span
      ref={anchor}
      className={styles.downloads}
      data-unviewed={(downloads.unviewed && !inProgress) || undefined}
    >
      <ActionMenu
        label={inProgress ? `Downloads, ${inProgress} in progress` : 'Downloads'}
        icon={inProgress ? 'I014' : downloads.justCompleted ? 'I072' : 'I049'}
        triggerSize='bar'
        align='end'
        heading='Downloads'
        open={downloads.open}
        onOpenChange={(open) => downloads.onOpenChange(open, anchor.current)}
        actions={() =>
          downloads.rows.map((row) => ({
            id: row.id,
            label: row.filename,
            icon:
              row.state === 'progressing'
                ? 'I014'
                : row.state === 'completed'
                  ? 'I015'
                  : 'warning-circle',
            detail: row.detail,
            disabled: row.state !== 'completed',
            onSelect: () => downloads.reveal(row.id),
          }))
        }
      />
      {percent !== null && (
        <progress aria-hidden className={styles.downloadProgress} value={percent} max={100} />
      )}
    </span>
  )
}
