'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Disclosure } from '@sim/emcn/disclosure'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/agent-thinking/agent-thinking.module.css'

/** Within this distance of the end, new thinking keeps the reader at the bottom. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 24

interface AgentThinkingProps {
  thinking: string
  isStreaming: boolean
}

/**
 * An Agent block's reasoning above its output. It opens while the model streams and folds when it
 * finishes, unless the reader opened it themselves; a reopened, finished thought starts at its top.
 */
export function AgentThinking({ thinking, isStreaming }: AgentThinkingProps) {
  const [open, setOpen] = useState(isStreaming)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [stickToBottom, setStickToBottom] = useState(true)
  const wasStreaming = useRef(isStreaming)
  const reopenFromTop = useRef(false)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const streamed = wasStreaming.current
    wasStreaming.current = isStreaming
    if (isStreaming) {
      setOpen(true)
      setPinnedOpen(false)
      setStickToBottom(true)
      return
    }
    if (streamed && !pinnedOpen) setOpen(false)
  }, [isStreaming, pinnedOpen])

  useLayoutEffect(() => {
    const element = body.current
    if (!element || !open) return
    if (reopenFromTop.current && !isStreaming) {
      element.scrollTop = 0
      reopenFromTop.current = false
      return
    }
    if (isStreaming && stickToBottom) element.scrollTop = element.scrollHeight
  }, [thinking, open, isStreaming, stickToBottom])

  return (
    <div className={styles.thinking}>
      <Disclosure
        variant='activity'
        label={isStreaming ? 'Thinking' : 'Thought for a moment'}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          setPinnedOpen(next && !isStreaming)
          if (next) {
            setStickToBottom(isStreaming)
            reopenFromTop.current = !isStreaming
          }
        }}
      >
        <div
          ref={body}
          className={styles.body}
          data-streaming={isStreaming || undefined}
          data-type='T048'
          onScroll={(event) => {
            const element = event.currentTarget
            const fromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
            setStickToBottom(fromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX)
          }}
        >
          {thinking}
        </div>
      </Disclosure>
    </div>
  )
}
