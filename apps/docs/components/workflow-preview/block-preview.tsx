'use client'

import {
  BLOCK_DISPLAY_SPECS,
  type BlockDisplaySpec,
} from '@/components/workflow-preview/block-display-specs'
import { BLOCK_ICONS } from '@/components/workflow-preview/block-icons'

/** Display scale for the hero — bump this one number to resize. */
const SCALE = 1.3

const DOT = '-translate-y-1/2 absolute top-1/2 h-5 w-[7px]'
const HEADER_DOT = '-translate-y-1/2 absolute top-[20px] h-5 w-[7px]'

/**
 * Static, app-styled block card — the same visual as the canvas WorkflowBlock, but
 * with non-interactive decorative handles (no ReactFlow, so it can't be panned/dragged).
 */
function BlockCard({ spec }: { spec: BlockDisplaySpec }) {
  const Icon = BLOCK_ICONS[spec.type]
  const branches = spec.branches ?? []
  const hasContent = spec.rows.length > 0 || branches.length > 0 || Boolean(spec.showError)

  return (
    <div className='relative w-[250px] select-none rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)]'>
      {!spec.hideTargetHandle && (
        <span className={`${HEADER_DOT} left-[-8px] rounded-l-[2px] bg-[var(--workflow-edge)]`} />
      )}
      {!spec.hideSourceHandle && (
        <span className={`${HEADER_DOT} right-[-8px] rounded-r-[2px] bg-[var(--workflow-edge)]`} />
      )}

      <div
        className={`flex items-center justify-between p-2 ${hasContent ? 'border-[var(--border-1)] border-b' : ''}`}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <div
            className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
            style={{ background: spec.bgColor }}
          >
            {Icon && <Icon className='size-[16px] text-white' />}
          </div>
          <span className='truncate font-medium text-[16px] text-[var(--text-primary)]'>
            {spec.name}
          </span>
        </div>
      </div>

      {hasContent && (
        <div className='flex flex-col gap-2 p-2'>
          {spec.rows.map((row) => (
            <div key={row.title} className='flex items-center gap-2'>
              <span className='flex-shrink-0 font-normal text-[14px] text-[var(--text-tertiary)] capitalize'>
                {row.title}
              </span>
              {row.value && (
                <span className='flex min-w-0 flex-1 items-center justify-end font-normal text-[14px] text-[var(--text-primary)]'>
                  <span className='truncate'>{row.value}</span>
                </span>
              )}
            </div>
          ))}

          {branches.map((branch) => (
            <div key={branch} className='relative flex items-center justify-between gap-2'>
              <span className='flex-shrink-0 font-normal text-[14px] text-[var(--text-tertiary)] capitalize'>
                {branch}
              </span>
              <span className='font-normal text-[14px] text-[var(--text-tertiary)]'>-</span>
              <span className={`${DOT} right-[-16px] rounded-r-[2px] bg-[var(--workflow-edge)]`} />
            </div>
          ))}

          {spec.showError && (
            <div className='relative flex items-center'>
              <span className='flex-shrink-0 font-normal text-[14px] text-[var(--text-tertiary)] capitalize'>
                error
              </span>
              <span className={`${DOT} right-[-16px] rounded-r-[2px] bg-[var(--text-error)]`} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface BlockPreviewProps {
  /** Block key from {@link BLOCK_DISPLAY_SPECS} (e.g. `agent`, `condition`, `webhook_trigger`). */
  type: string
}

/**
 * Renders a single block exactly as it appears on the builder canvas, from its
 * hand-authored display spec — static (no canvas) and scaled up. Use as the hero on a
 * block reference page: `<BlockPreview type="agent" />`. Edit specs in `block-display-specs.ts`.
 */
export function BlockPreview({ type }: BlockPreviewProps) {
  const spec = BLOCK_DISPLAY_SPECS[type]
  if (!spec) return null

  return (
    <div className='not-prose my-6 flex justify-center overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg)] px-6 py-10'>
      <div style={{ zoom: SCALE }}>
        <BlockCard spec={spec} />
      </div>
    </div>
  )
}
