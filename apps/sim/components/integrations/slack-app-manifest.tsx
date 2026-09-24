'use client'

import { useState } from 'react'
import { Chip, Code, useCopyToClipboard } from '@sim/emcn'
import { Check, Clipboard } from '@sim/emcn/icons'

interface SlackAppManifestProps {
  manifest: string
  disabled?: boolean
  onCopy?: (manifest: string) => void
}

/** Shared copy action and optional preview for Slack app setup flows. */
export function SlackAppManifest({ manifest, disabled, onCopy }: SlackAppManifestProps) {
  const { copied, copy } = useCopyToClipboard()
  const [copiedManifest, setCopiedManifest] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const showCopied = copied && copiedManifest === manifest && !copyFailed

  async function copyManifest() {
    setCopyFailed(false)
    const success = await copy(manifest)
    if (!success) {
      setCopyFailed(true)
      return
    }
    setCopiedManifest(manifest)
    onCopy?.(manifest)
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2'>
        <Chip
          variant='primary'
          leftIcon={showCopied ? Check : Clipboard}
          disabled={disabled || !manifest}
          onClick={() => void copyManifest()}
        >
          Copy manifest
        </Chip>
        {showCopied && (
          <span role='status' className='text-[var(--text-secondary)] text-caption'>
            Manifest copied
          </span>
        )}
      </div>
      {copyFailed && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          Could not copy the manifest. Allow clipboard access and try again.
        </p>
      )}
      <details>
        <summary className='cursor-pointer text-[var(--text-secondary)] text-caption'>
          View manifest
        </summary>
        <div className='mt-2 overflow-hidden rounded-md border border-[var(--border)]'>
          <Code.Viewer code={manifest} language='json' wrapText className='max-h-[180px]' />
        </div>
      </details>
    </div>
  )
}
