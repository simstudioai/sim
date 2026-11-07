'use client'

import { useEffect, useState } from 'react'
import { ActivityBody } from '@sim/emcn/activity-row/activity-body'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { generateId } from '@sim/utils/id'
import styles from '@/platform/app/(shell)/_components/chat/cards/cards.module.css'
import type { PlatformTool, ToolDecision } from '@/platform/app/(shell)/_components/chat/model'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import {
  useChatHandlers,
  useChatInteractions,
} from '@/platform/app/(shell)/_components/session/chat-runtime'

const BROWSER_TOOL = /^browser[_-]/

/**
 * The prompt for a gated tool call. The orchestrator holds this tool's result, and with it the whole
 * turn, until one of these is answered; a failed answer restores the buttons so it can be retried.
 */
export function ToolApproval({ tool }: { tool: PlatformTool }) {
  const { approvals } = useChatInteractions()
  const { registerApproval, decideTools } = useChatHandlers()
  const { notify } = usePlatformNotices()
  const [expired, setExpired] = useState(false)
  useEffect(() => registerApproval(tool.id), [registerApproval, tool.id])
  const { outstanding, submitted } = approvals
  const busy = submitted.includes(tool.id)
  const browser = BROWSER_TOOL.test(tool.name)
  async function submit(decision: ToolDecision, ids: readonly string[]) {
    try {
      const result = await decideTools(ids, decision)
      if (result === 'gone') setExpired(true)
    } catch {
      notify({
        id: generateId(),
        icon: 'I047',
        title: 'Could not record your choice. Please try again.',
      })
    }
  }
  if (expired)
    return (
      <p className={styles.quiet} data-type='T048'>
        {tool.title} — this request is no longer active
      </p>
    )
  return (
    <div className={styles.card}>
      <ActivityBody leading={<Icon name='I084' />} decorativeLeading>
        <span className={styles.title} data-type='T048' title={tool.input}>
          {tool.title}
        </span>
      </ActivityBody>
      <div className={styles.actions}>
        <Button
          variant='primary'
          size='compact'
          disabled={busy}
          onClick={() => void submit('allow', [tool.id])}
        >
          Allow
        </Button>
        <ActionMenu
          label="Don't ask again"
          icon='I051'
          actions={[
            {
              id: 'chat',
              label: browser ? 'Browser actions in this chat' : 'For this chat',
              disabled: busy,
              onSelect: () => void submit('allow_chat', [tool.id]),
            },
            {
              id: 'every',
              label: browser ? 'Browser actions in every chat' : 'For every chat',
              disabled: busy,
              onSelect: () => void submit('always_allow', [tool.id]),
            },
          ]}
        />
        <Button
          variant='muted'
          size='compact'
          disabled={busy}
          onClick={() => void submit('skip', [tool.id])}
        >
          Skip
        </Button>
      </div>
      {outstanding.length > 1 && outstanding[0] === tool.id && (
        <div className={styles.actions}>
          <span className={styles.quiet} data-type='T052'>
            {outstanding.length} tools need permission
          </span>
          <Button
            variant='muted'
            size='compact'
            disabled={busy}
            onClick={() => void submit('allow', outstanding)}
          >
            Allow all
          </Button>
          <Button
            variant='muted'
            size='compact'
            disabled={busy}
            onClick={() => void submit('skip', outstanding)}
          >
            Skip all
          </Button>
        </div>
      )}
    </div>
  )
}
