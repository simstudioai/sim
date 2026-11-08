'use client'

import { IconButton } from '@sim/emcn/button'
import { Icon, type IconName } from '@sim/emcn/icon'
import { FALLBACK_PROVIDER_MARK, providerMark } from '@sim/emcn/icon/provider-marks'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { previewBlocks } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/outputs'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/workflow-panel.module.css'
import type { WorkflowState } from '@/platform/lib/data/workflows'

/** Core blocks with an interface glyph of their own; an integration block shows its provider mark. */
const BLOCK_GLYPHS: Partial<Record<string, IconName>> = {
  agent: 'I128',
  loop: 'I130',
  mcp: 'I126',
  parallel: 'I129',
  start_trigger: 'play',
  starter: 'play',
  workflow: 'I118',
  workflow_input: 'I118',
}

function BlockMark({ type }: { type: string }) {
  const glyph = BLOCK_GLYPHS[type]
  if (glyph) return <Icon name={glyph} />
  if (providerMark(type) !== FALLBACK_PROVIDER_MARK) return <Icon providerId={type} />
  return <Icon name='I127' />
}

interface WorkflowPreviewProps {
  /** The active deployment a table run executes; `null` when the workflow has none. */
  state: WorkflowState | null
  /** Opens the workflow in a new tab; omitted where the panel keeps the workflow fixed. */
  onOpen?: () => void
}

/**
 * The deployment's blocks in run order, as a compact stand-in for the legacy canvas preview, with a
 * way to open the workflow itself.
 */
export function WorkflowPreview({ state, onOpen }: WorkflowPreviewProps) {
  const list = useScrollEdges<HTMLOListElement>('vertical')
  const blocks = previewBlocks(state)
  return (
    <div className={styles.preview}>
      {state ? (
        <ol ref={list} className={styles.previewBlocks} aria-label='Workflow blocks'>
          {blocks.map((block) => (
            <li key={block.id} className={styles.previewBlock}>
              <span className={styles.previewMark} aria-hidden='true'>
                <BlockMark type={block.type} />
              </span>
              <span className={styles.previewName} data-type='T060'>
                <OverflowText text={block.name}>{block.name}</OverflowText>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.previewNote} data-type='T060'>
          Unable to load preview
        </p>
      )}
      {state && onOpen && (
        <span className={styles.previewOpen}>
          <IconButton
            label='Open workflow'
            icon='I037'
            size='compact'
            variant='floating'
            tooltip
            onClick={onOpen}
          />
        </span>
      )}
    </div>
  )
}
