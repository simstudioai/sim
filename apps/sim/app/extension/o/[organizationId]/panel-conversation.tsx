'use client'

import { type ReactNode, useRef } from 'react'
import { ChipModal, ChipModalHeader } from '@sim/emcn'
import { AssistantActionReviewProvider } from '@/components/assistant-actions'
import { PanelComposer } from '@/app/extension/o/[organizationId]/panel-composer'
import {
  useConversationGate,
  useOrganizationConversation,
} from '@/app/o/[organizationId]/components/use-organization-conversation'
import { ComposerScrollArea } from '@/app/workspace/[workspaceId]/home/components/composer-scroll-area'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { SourcesResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/sources-resource-content'
import type { ModelSelectorOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import type { PrepareChatSubmission } from '@/hooks/use-composer-submission'

interface PanelConversationProps {
  chatId?: string
  requestMode: ChatRequestMode
  header: ReactNode
  attachments?: ReactNode
  resourceActions?: ReactNode
  toolbarActions?: ReactNode
  modelSelectorOptions?: ModelSelectorOptions
  onChatIdResolved: (chatId: string) => void
  onNavigateToChat: (chatId: string) => void
  prepareSubmission: PrepareChatSubmission
  onSubmitted: () => void
  draftNamespace: string
}

/** The shared conversation in the extension's side panel. */
export function PanelConversation(props: PanelConversationProps) {
  const gate = useConversationGate(props)
  if (gate.status === 'denied') return null
  if (gate.status !== 'ready') return <HomeFallback />
  return <PanelConversationContent key={gate.instanceKey} {...props} />
}

function PanelConversationContent({
  chatId,
  requestMode,
  header,
  attachments,
  resourceActions,
  toolbarActions,
  modelSelectorOptions,
  onChatIdResolved,
  onNavigateToChat,
  prepareSubmission,
  onSubmitted,
  draftNamespace,
}: PanelConversationProps) {
  const fileDropTarget = useRef<HTMLElement>(null)
  const { chat, controller, hasChat, composerProps, threadProps, reviewProps } =
    useOrganizationConversation({
      surface: {
        kind: 'panel',
        draftNamespace,
        fileDropTarget,
        onChatIdResolved,
        prepareSubmission,
        onSubmitted,
      },
      chatId,
      requestMode,
    })
  const composer = (
    <PanelComposer
      {...composerProps}
      attachments={attachments}
      resourceActions={resourceActions}
      toolbarActions={toolbarActions}
      modelSelectorOptions={modelSelectorOptions}
    />
  )
  const closeSources = () => controller.activeResourceState[1](null)
  const sourceResource = chat.resources.find(
    (resource) => resource.type === 'sources' && resource.id === controller.activeResourceParam
  )
  return (
    <main
      ref={fileDropTarget}
      className='ph-no-capture flex h-dvh min-w-0 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-body)]'
    >
      {header}
      <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]'>
        {hasChat ? (
          <AssistantActionReviewProvider {...reviewProps}>
            <MothershipChat
              {...threadProps}
              onNavigateToChat={onNavigateToChat}
              layout='copilot-view'
              SearchConnectionComponent={SearchIntegrationConnection}
              composer={composer}
              initialScrollBlocked={false}
            />
          </AssistantActionReviewProvider>
        ) : (
          <>
            <div className='flex flex-1 items-center justify-center px-5'>
              <h1 className='text-lg'>How can I help?</h1>
            </div>
            <ComposerScrollArea className='px-3 pb-3'>{composer}</ComposerScrollArea>
          </>
        )}
      </div>
      <ChipModal
        open={Boolean(sourceResource)}
        onOpenChange={(open) => {
          if (!open) closeSources()
        }}
        srTitle='Cited sources'
        size='sm'
      >
        <ChipModalHeader onClose={closeSources}>Cited sources</ChipModalHeader>
        {sourceResource && (
          <div className='h-[60dvh] min-h-0'>
            <SourcesResourceContent chatId={chat.resolvedChatId} resource={sourceResource} />
          </div>
        )}
      </ChipModal>
    </main>
  )
}
