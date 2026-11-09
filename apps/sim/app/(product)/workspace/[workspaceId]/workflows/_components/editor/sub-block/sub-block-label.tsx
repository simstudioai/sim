'use client'

import type { MutableRefObject, ReactNode } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Icon } from '@sim/emcn/icon'
import { Tooltip } from '@sim/emcn/tooltip'
import { GeneratePrompt } from '@/app/(product)/workspace/[workspaceId]/_components/generate-prompt/generate-prompt'
import { FieldLabelRow } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/field-label-row/field-label-row'
import type { CanonicalToggle } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block.module.css'
import type { WandControlHandlers } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
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
    <FieldLabelRow
      label={
        <>
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
        </>
      }
      actions={
        <>
          {copyValue && !isPreview && (
            <CopyButton label='Copy value' text={copyValue} size='compact' />
          )}
          {showWand && (
            <GeneratePrompt
              isLoading={false}
              isStreaming={isStreaming}
              placeholder='Generate with AI…'
              onSubmit={(prompt) => wandControlRef.current?.onWandTrigger(prompt)}
            />
          )}
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
        </>
      }
    />
  )
}
