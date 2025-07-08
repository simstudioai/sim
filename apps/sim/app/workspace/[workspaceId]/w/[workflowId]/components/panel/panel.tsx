'use client'

import { useEffect, useState, useRef } from 'react'
import { Expand, PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { usePanelStore } from '@/stores/panel/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { Chat } from './components/chat/chat'
import { ChatModal } from './components/chat/components/chat-modal/chat-modal'
import { Console } from './components/console/console'
import { Variables } from './components/variables/variables'
import { Copilot } from './components/copilot/copilot'

export function Panel() {
  const [width, setWidth] = useState(336) // 84 * 4 = 336px (default width)
  const [isDragging, setIsDragging] = useState(false)
  const [chatMessage, setChatMessage] = useState<string>('')
  const [isChatModalOpen, setIsChatModalOpen] = useState(false)
  const copilotRef = useRef<{ clearMessages: () => void }>(null)

  const isOpen = usePanelStore((state) => state.isOpen)
  const togglePanel = usePanelStore((state) => state.togglePanel)
  const activeTab = usePanelStore((state) => state.activeTab)
  const setActiveTab = usePanelStore((state) => state.setActiveTab)

  const clearConsole = useConsoleStore((state) => state.clearConsole)
  const clearChat = useChatStore((state) => state.clearChat)
  const { activeWorkflowId } = useWorkflowRegistry()

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newWidth = window.innerWidth - e.clientX
        setWidth(Math.max(336, Math.min(newWidth, window.innerWidth * 0.8)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  if (!isOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={togglePanel}
            className='fixed right-4 bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          >
            <PanelRight className='h-5 w-5' />
            <span className='sr-only'>Open Panel</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Open Panel</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <>
      <div
        className='fixed top-16 right-0 z-10 flex h-[calc(100vh-4rem)] flex-col border-l bg-background'
        style={{ width: `${width}px` }}
      >
        <div
          className='absolute top-0 bottom-0 left-[-4px] z-50 w-4 cursor-ew-resize hover:bg-accent/50'
          onMouseDown={handleMouseDown}
        />

        {/* Panel Header */}
        <div className='flex h-14 flex-none items-center justify-between border-b px-4'>
          <div className='flex gap-2'>
            <button
              onClick={() => setActiveTab('chat')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                activeTab === 'chat'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('console')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                activeTab === 'console'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              Console
            </button>
            <button
              onClick={() => setActiveTab('variables')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                activeTab === 'variables'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              Variables
            </button>
            <button
              onClick={() => setActiveTab('copilot')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                activeTab === 'copilot'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              Copilot
            </button>
          </div>

          {(activeTab === 'console' || activeTab === 'chat' || activeTab === 'copilot') && (
            <button
              onClick={() => {
                if (activeTab === 'console') {
                  clearConsole(activeWorkflowId)
                } else if (activeTab === 'chat') {
                  clearChat(activeWorkflowId)
                } else if (activeTab === 'copilot') {
                  copilotRef.current?.clearMessages()
                }
              }}
              className='rounded-md px-3 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent/50 hover:text-foreground'
            >
              Clear
            </button>
          )}
        </div>

        {/* Panel Content */}
        <div className='flex-1 overflow-hidden'>
          {activeTab === 'chat' ? (
            <Chat panelWidth={width} chatMessage={chatMessage} setChatMessage={setChatMessage} />
          ) : activeTab === 'console' ? (
            <Console panelWidth={width} />
          ) : activeTab === 'copilot' ? (
            <Copilot ref={copilotRef} panelWidth={width} />
          ) : (
            <Variables panelWidth={width} />
          )}
        </div>

        {/* Panel Footer */}
        <div className='flex h-16 flex-none items-center justify-between border-t bg-background px-4'>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={togglePanel}
                className='flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              >
                <PanelRight className='h-5 w-5 rotate-180 transform' />
                <span className='sr-only'>Close Panel</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side='right'>Close Panel</TooltipContent>
          </Tooltip>

          {activeTab === 'chat' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsChatModalOpen(true)}
                  className='flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                >
                  <Expand className='h-5 w-5' />
                  <span className='sr-only'>Expand Chat</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side='left'>Expand Chat</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Fullscreen Chat Modal */}
      <ChatModal
        open={isChatModalOpen}
        onOpenChange={setIsChatModalOpen}
        chatMessage={chatMessage}
        setChatMessage={setChatMessage}
      />
    </>
  )
}
