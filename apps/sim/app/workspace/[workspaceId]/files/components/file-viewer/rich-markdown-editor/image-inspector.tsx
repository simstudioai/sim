import { type KeyboardEvent, useId, useState } from 'react'
import { Button, ChipInput } from '@sim/emcn'
import { Check, RefreshCw, Settings, X } from '@sim/emcn/icons'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { ToolbarButton } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'

interface ImageDetails {
  alt: string
  href: string
}

interface ImageInspectorProps extends ImageDetails {
  hasCustomSize: boolean
  onApply: (details: ImageDetails) => void
  onResetSize: () => void
  onReturnFocus: () => void
}

/** Selection-local controls for accessible image text, links, and explicit sizing. */
export function ImageInspector({
  alt,
  href,
  hasCustomSize,
  onApply,
  onResetSize,
  onReturnFocus,
}: ImageInspectorProps) {
  const [draft, setDraft] = useState<ImageDetails | null>(null)
  const errorId = useId()
  const normalizedHref = draft ? normalizeLinkHref(draft.href.trim()) : ''
  const invalidHref = Boolean(draft?.href.trim()) && !normalizedHref

  const close = () => {
    setDraft(null)
    queueMicrotask(onReturnFocus)
  }

  const apply = () => {
    if (!draft || invalidHref) return
    onApply({ alt: draft.alt, href: normalizedHref })
    close()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      apply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div
      contentEditable={false}
      className='absolute top-full left-0 z-[var(--z-popover)] mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-xs'
      onPointerDown={(event) => event.stopPropagation()}
    >
      {draft ? (
        <div className='flex w-[min(300px,calc(100vw_-_4rem))] flex-col gap-1.5 p-1'>
          <ChipInput
            autoFocus
            value={draft.alt}
            aria-label='Image alt text'
            placeholder='Alt text'
            onChange={(event) =>
              setDraft((current) => ({ ...(current ?? draft), alt: event.target.value }))
            }
            onKeyDown={handleKeyDown}
          />
          <ChipInput
            value={draft.href}
            aria-label='Image link URL'
            placeholder='Link URL (optional)'
            inputMode='url'
            error={invalidHref}
            aria-invalid={invalidHref}
            aria-describedby={invalidHref ? errorId : undefined}
            onChange={(event) =>
              setDraft((current) => ({ ...(current ?? draft), href: event.target.value }))
            }
            onKeyDown={handleKeyDown}
          />
          {invalidHref && (
            <p id={errorId} role='alert' className='px-1 text-[var(--text-error)] text-caption'>
              Enter a valid link.
            </p>
          )}
          <div className='flex justify-end gap-1'>
            <Button type='button' size='sm' onClick={close}>
              <X className='mr-1 size-[14px]' />
              Cancel
            </Button>
            <Button
              type='button'
              variant='primary'
              size='sm'
              disabled={invalidHref}
              onClick={apply}
            >
              <Check className='mr-1 size-[14px]' />
              Apply
            </Button>
          </div>
        </div>
      ) : (
        <div role='group' aria-label='Image editing' className='flex items-center gap-0.5'>
          <ToolbarButton
            icon={Settings}
            label='Edit image details'
            onClick={() => setDraft({ alt, href })}
          />
          {hasCustomSize && (
            <ToolbarButton
              icon={RefreshCw}
              label='Reset image size'
              onClick={() => {
                onResetSize()
                queueMicrotask(onReturnFocus)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
