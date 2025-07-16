'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, CircleSlash, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { usePanelStore } from '@/stores/panel/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { Chat } from './components/chat/chat'
import { ChatModal } from './components/chat/components/chat-modal/chat-modal'
import { Console } from './components/console/console'
import { Variables } from './components/variables/variables'

export function Panel() {
  const [chatMessage, setChatMessage] = useState<string>('')
  const [copilotMessage, setCopilotMessage] = useState<string>('')
  const [isChatModalOpen, setIsChatModalOpen] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)

  const isOpen = usePanelStore((state) => state.isOpen)
  const togglePanel = usePanelStore((state) => state.togglePanel)
  const activeTab = usePanelStore((state) => state.activeTab)
  const setActiveTab = usePanelStore((state) => state.setActiveTab)
  const panelWidth = usePanelStore((state) => state.panelWidth)
  const setPanelWidth = usePanelStore((state) => state.setPanelWidth)

  const clearConsole = useConsoleStore((state) => state.clearConsole)
  const exportConsoleCSV = useConsoleStore((state) => state.exportConsoleCSV)
  const clearChat = useChatStore((state) => state.clearChat)
  const exportChatCSV = useChatStore((state) => state.exportChatCSV)
  const { activeWorkflowId } = useWorkflowRegistry()

  const handleTabClick = (tab: 'chat' | 'console' | 'variables') => {
    setActiveTab(tab)
    if (!isOpen) {
      togglePanel()
    }
  }

  const handleClosePanel = () => {
    togglePanel()
  }

  // Resize functionality
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isOpen) return
      e.preventDefault()
      setIsResizing(true)
      setResizeStartX(e.clientX)
      setResizeStartWidth(panelWidth)
    },
    [isOpen, panelWidth]
  )

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return
      const deltaX = resizeStartX - e.clientX // Subtract because we're expanding left
      const newWidth = resizeStartWidth + deltaX
      setPanelWidth(newWidth)
    },
    [isResizing, resizeStartX, resizeStartWidth, setPanelWidth]
  )

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Add global mouse event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      return () => {
        document.removeEventListener('mousemove', handleResize)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleResize, handleResizeEnd])

  return (
    <>
      {/* Tab Selector - Always visible */}
      <div className='fixed top-[76px] right-4 z-20 flex h-9 w-[308px] items-center gap-1 rounded-[14px] border bg-card px-[2.5px] py-1 shadow-xs'>
        <button
          onClick={() => handleTabClick('chat')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'chat' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => handleTabClick('console')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'console' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Console
        </button>
        <button
          onClick={() => handleTabClick('variables')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'variables' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Variables
        </button>
      </div>

      {/* Panel Content - Only visible when isOpen is true */}
      {isOpen && (
        <div
          className='fixed top-[124px] right-4 bottom-4 z-10 flex flex-col rounded-[14px] border bg-card shadow-xs'
          style={{ width: `${panelWidth}px` }}
        >
          {/* Invisible resize handle */}
          <div
            className='-left-1 absolute top-0 bottom-0 w-2 cursor-col-resize'
            onMouseDown={handleResizeStart}
          />

          {/* Header - Fixed width content */}
          <div className='flex items-center justify-between px-3 pt-3 pb-1'>
            <h2 className='font-[450] text-base text-card-foreground capitalize'>{activeTab}</h2>
            <div className='flex items-center gap-2'>
              {activeTab === 'console' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => activeWorkflowId && exportConsoleCSV(activeWorkflowId)}
                      className='font-medium text-md leading-normal transition-all hover:brightness-75 dark:hover:brightness-125'
                      style={{ color: 'var(--base-muted-foreground)' }}
                    >
                      <ArrowDownToLine className='h-4 w-4' strokeWidth={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom'>Export console data</TooltipContent>
                </Tooltip>
              )}
              {activeTab === 'chat' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => activeWorkflowId && exportChatCSV(activeWorkflowId)}
                      className='font-medium text-md leading-normal transition-all hover:brightness-75 dark:hover:brightness-125'
                      style={{ color: 'var(--base-muted-foreground)' }}
                    >
                      <ArrowDownToLine className='h-4 w-4' strokeWidth={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom'>Export chat data</TooltipContent>
                </Tooltip>
              )}
              {(activeTab === 'console' || activeTab === 'chat') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() =>
                        activeTab === 'console'
                          ? clearConsole(activeWorkflowId)
                          : clearChat(activeWorkflowId)
                      }
                      className='font-medium text-md leading-normal transition-all hover:brightness-75 dark:hover:brightness-125'
                      style={{ color: 'var(--base-muted-foreground)' }}
                    >
                      <CircleSlash className='h-4 w-4' strokeWidth={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom'>Clear {activeTab}</TooltipContent>
                </Tooltip>
              )}
              <button
                onClick={handleClosePanel}
                className='font-medium text-md leading-normal transition-all hover:brightness-75 dark:hover:brightness-125'
                style={{ color: 'var(--base-muted-foreground)' }}
              >
                <X className='h-4 w-4' strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Panel Content Area - Resizable */}
          <div className='flex-1 overflow-hidden px-3'>
            {activeTab === 'chat' ? (
              <Chat
                panelWidth={panelWidth}
                chatMessage={chatMessage}
                setChatMessage={setChatMessage}
              />
            ) : activeTab === 'console' ? (
              <Console panelWidth={panelWidth} />
            ) : (
              <Variables />
            )}
          </div>
        </div>
      )}

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
