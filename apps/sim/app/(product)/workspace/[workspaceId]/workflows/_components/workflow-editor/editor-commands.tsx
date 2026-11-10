'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { useRegisterGlobalCommands } from '@/app/(product)/_components/workspace/workflows/global-commands/global-commands'
import { useChatHandoff } from '@/platform/lib/data/chat-handoff'
import { useTerminalConsoleStore } from '@/platform/lib/data/workflow-deploy/terminal'
import { createCommand } from '@/platform/lib/data/workflows'
import { usePlatformHref } from '@/platform/lib/navigation'

interface EditorShortcutsProps {
  workspaceId: string
  canEdit: boolean
  onNewWorkflow: () => void
}

/**
 * The editor's shortcuts the empty canvas's command list and the canvas menu advertise: Mod+Shift+A
 * adds an Agent block, Mod+L opens the workspace's logs and Mod+Shift+P creates a workflow (for an
 * editor), as legacy's workflow layout registered them.
 */
export function EditorShortcuts({ workspaceId, canEdit, onNewWorkflow }: EditorShortcutsProps) {
  const router = useRouter()
  const hrefFor = usePlatformHref()
  useRegisterGlobalCommands(() => [
    createCommand({
      id: 'add-agent',
      handler: () => {
        window.dispatchEvent(
          new CustomEvent('add-block-from-toolbar', {
            detail: { type: 'agent', enableTriggerMode: false },
          })
        )
      },
    }),
    createCommand({
      id: 'goto-logs',
      handler: () => {
        router.push(hrefFor(workspacePath(workspaceId, 'logs')))
      },
    }),
    createCommand({
      id: 'add-workflow',
      handler: () => {
        if (canEdit) onNewWorkflow()
      },
    }),
  ])
  return null
}

/**
 * Lets a block error's toast offer "Fix in Chat" while the editor is mounted and the viewer can
 * start a chat, handing the error to a new chat as the terminal's row menu does.
 */
export function BlockErrorChatHandoff() {
  const chat = useChatHandoff()
  const handOffRef = useRef(chat.handOff)
  handOffRef.current = chat.handOff
  useEffect(() => {
    if (!chat.available) return
    const { setChatHandoff } = useTerminalConsoleStore.getState()
    setChatHandoff((message) => handOffRef.current({ message }))
    return () => setChatHandoff(null)
  }, [chat.available])
  return null
}
