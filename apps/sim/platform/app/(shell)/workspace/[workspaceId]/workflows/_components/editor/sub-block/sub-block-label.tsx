'use client'

import { type MutableRefObject, type ReactNode, useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Icon } from '@sim/emcn/icon'
import { Tooltip } from '@sim/emcn/tooltip'
import type { CanonicalToggle } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block.module.css'
import type { WandControlHandlers } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
import type { SubBlockConfig } from '@/platform/lib/data/workflow-editor'

interface SubBlockLabelProps {
  config: SubBlockConfig
  isValidJson: boolean
  required: boolean
  isPreview: boolean
  disabled: boolean
  wandControlRef: MutableRefObject<WandControlHandlers | null>
  canonicalToggle?: CanonicalToggle
  canonicalToggleDisabled: boolean
  /** A webhook URL the row offers to copy. */
  copyValue?: string
  labelSuffix?: ReactNode
  /** The selected table or knowledge base, opened in a new tab. */
  linkedResource?: { label: string; onOpen: () => void }
}

/**
 * A sub-block's label row: title, required mark and JSON validity on the start; copy, AI generate,
 * linked resource and the basic/advanced swap at the end.
 */
export function SubBlockLabel({
  config,
  isValidJson,
  required,
  isPreview,
  disabled,
  wandControlRef,
  canonicalToggle,
  canonicalToggleDisabled,
  copyValue,
  labelSuffix,
  linkedResource,
}: SubBlockLabelProps) {
  if (config.type === 'switch' || !config.title) return null
  const showWand = (config.wandConfig?.enabled ?? false) && !isPreview && !disabled
  const isStreaming = wandControlRef.current?.isWandStreaming ?? false
  return (
    <div className={styles.labelRow}>
      <span className={styles.label} data-type='T059'>
        {config.title}
        {required && <span aria-label='required'> *</span>}
        {labelSuffix}
        {config.type === 'code' && config.language === 'json' && !isValidJson && !isStreaming && (
          <Tooltip label='Invalid JSON'>
            <span className={styles.invalid} role='img' aria-label='Invalid JSON'>
              <Icon name='warning-triangle' />
            </span>
          </Tooltip>
        )}
      </span>
      <span className={styles.labelActions}>
        {copyValue && !isPreview && (
          <CopyButton label='Copy value' text={copyValue} size='compact' />
        )}
        {showWand && <WandInline wandControlRef={wandControlRef} />}
        {linkedResource && !isPreview && (
          <IconButton
            label={linkedResource.label}
            icon='I037'
            size='compact'
            tooltip
            onClick={linkedResource.onOpen}
          />
        )}
        {canonicalToggle && !isPreview && (
          <Button
            variant='quiet'
            size='compact'
            aria-label={
              canonicalToggle.mode === 'advanced' ? 'Switch to selector' : 'Switch to manual ID'
            }
            disabled={canonicalToggleDisabled}
            onClick={canonicalToggle.onToggle}
          >
            {canonicalToggle.mode === 'advanced' ? 'Selector' : 'Manual ID'}
          </Button>
        )}
      </span>
    </div>
  )
}

interface WandInlineProps {
  wandControlRef: MutableRefObject<WandControlHandlers | null>
}

/** Generate, which opens an inline prompt that streams its result into the field. */
function WandInline({ wandControlRef }: WandInlineProps) {
  const [active, setActive] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const isStreaming = wandControlRef.current?.isWandStreaming ?? false

  const submit = () => {
    if (!query.trim() || !wandControlRef.current) return
    wandControlRef.current.onWandTrigger(query)
    setQuery('')
    setActive(false)
  }

  if (!active)
    return (
      <Button
        variant='quiet'
        size='compact'
        onClick={() => {
          setActive(true)
          requestAnimationFrame(() => input.current?.focus())
        }}
      >
        Generate
      </Button>
    )

  return (
    <span className={styles.wand}>
      <input
        ref={input}
        className={styles.wandInput}
        data-type='T060'
        aria-label='Generate with AI'
        value={isStreaming ? 'Generating...' : query}
        disabled={isStreaming}
        placeholder='Generate with AI...'
        onChange={(event) => setQuery(event.target.value)}
        onBlur={(event) => {
          if ((event.relatedTarget as HTMLElement | null)?.closest('button')) return
          if (!query.trim() && !wandControlRef.current?.isWandStreaming) setActive(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim() && !isStreaming) submit()
          else if (event.key === 'Escape') {
            setQuery('')
            setActive(false)
          }
        }}
      />
      <IconButton
        label='Generate'
        icon='I023'
        size='compact'
        variant='solid'
        disabled={!query.trim() || isStreaming}
        onClick={submit}
      />
    </span>
  )
}
