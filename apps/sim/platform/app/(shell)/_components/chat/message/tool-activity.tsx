'use client'

import { useState } from 'react'
import { ToolApproval } from '@/platform/app/(shell)/_components/chat/cards/tool-approval'
import styles from '@/platform/app/(shell)/_components/chat/message/message.module.css'
import type {
  PlatformTool,
  PlatformToolStatus,
} from '@/platform/app/(shell)/_components/chat/model'
import { useChatRuntime } from '@/platform/app/(shell)/_components/session/chat-runtime'
import {
  Button,
  CopyButton,
  Disclosure,
  Icon,
  StatusTag,
} from '@/platform/design-system/components'

/** Terminal states other than success read beside the row, so a reader never takes them for done. */
const STATUS_TAG: Partial<
  Record<PlatformToolStatus, { label: string; intent: 'danger' | 'warning' | 'neutral' | 'info' }>
> = {
  executing: { label: 'Running', intent: 'info' },
  error: { label: 'Failed', intent: 'danger' },
  cancelled: { label: 'Stopped', intent: 'neutral' },
  skipped: { label: 'Skipped', intent: 'neutral' },
  rejected: { label: 'Rejected', intent: 'warning' },
  interrupted: { label: 'Interrupted', intent: 'warning' },
}

function ToolRow({ step }: { step: PlatformTool }) {
  const tag = STATUS_TAG[step.status]
  const trailing = (
    <>
      {tag && <StatusTag label={tag.label} intent={tag.intent} />}
      {step.time && <time data-type='T052'>{step.time}</time>}
    </>
  )
  if (!step.input && !step.output && !step.error)
    return (
      <div className={styles.stepRow} data-status={step.status}>
        <span className={styles.name} data-type='T048'>
          {step.title}
        </span>
        {trailing}
      </div>
    )
  return (
    <details className={styles.step} data-status={step.status}>
      <summary>
        <span className={styles.name} data-type='T048'>
          {step.title}
          <Icon name='I090' />
        </span>
        {trailing}
      </summary>
      <dl className={styles.result}>
        {step.input !== undefined && (
          <div>
            <dt data-type='T048'>
              Input <CopyButton label='Copy tool input' text={step.input} />
            </dt>
            <dd>
              <code data-type='T009'>{step.input}</code>
            </dd>
          </div>
        )}
        {step.output !== undefined && (
          <div>
            <dt data-type='T048'>
              Response <CopyButton label='Copy tool response' text={step.output} />
            </dt>
            <dd>
              <code data-type='T009'>{step.output}</code>
            </dd>
          </div>
        )}
        {step.error && (
          <div>
            <dt data-type='T048'>Error</dt>
            <dd>
              <code data-type='T009'>{step.error}</code>
            </dd>
          </div>
        )}
      </dl>
    </details>
  )
}

interface ToolActivityProps {
  label: string
  initiallyOpen: boolean
  steps: readonly PlatformTool[]
  thinking?: string
  progress?: string
}

export function ToolActivity({
  label,
  initiallyOpen,
  steps,
  thinking,
  progress,
}: ToolActivityProps) {
  const introduction = (
    <>
      <hr className={styles.runRule} />
      {progress && <p data-type='T048'>{progress}</p>}
    </>
  )
  if (!thinking && !steps.length)
    return (
      <>
        <p className={styles.status} data-type='T048'>
          {label}
        </p>
        {introduction}
      </>
    )
  return (
    <Disclosure
      label={label}
      variant='activity'
      initiallyOpen={initiallyOpen}
      introduction={introduction}
    >
      <div className={styles.activityBody}>
        {thinking && <p data-type='T048'>{thinking}</p>}
        {steps.length > 0 && (
          <div className={styles.steps}>
            {steps.map((step) => (
              <ToolRow key={step.id} step={step} />
            ))}
          </div>
        )}
      </div>
    </Disclosure>
  )
}

function TerminalHandoff({ handoff }: { handoff: NonNullable<PlatformTool['handoff']> }) {
  const { finishTerminalHandoff } = useChatRuntime()
  const [done, setDone] = useState(false)
  return (
    <div className={styles.card} data-type='T048'>
      <p>{handoff.reason || 'Sim is waiting for you in the terminal.'}</p>
      <Button
        variant='muted'
        size='compact'
        disabled={done || !finishTerminalHandoff}
        onClick={() => {
          finishTerminalHandoff?.(handoff.terminalId)
          setDone(true)
        }}
      >
        {done ? 'Handed control back to Sim' : 'Hand control back to Sim'}
      </Button>
    </div>
  )
}

/** A call that holds the turn on a person. It stands apart so collapsing activity cannot hide it. */
export function ToolInteraction({ tool }: { tool: PlatformTool }) {
  const { review } = useChatRuntime()
  if (tool.handoff) return <TerminalHandoff handoff={tool.handoff} />
  if (tool.status !== 'awaiting_approval') return null
  if (review && tool.reviewed) {
    // The review card on this turn owns a proposed action; a call it no longer holds says so.
    if (review.actions.some((action) => action.id === tool.id) || review.status === 'error')
      return null
    return (
      <p className={styles.status} data-type='T048' role='status'>
        {review.status === 'loading'
          ? 'Loading action review'
          : `${tool.title} · No longer waiting for review`}
      </p>
    )
  }
  return <ToolApproval tool={tool} />
}
