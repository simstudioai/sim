'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useQueryState } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { ExtensionHeader } from '@/app/extension/[workspaceId]/header'
import { extensionChatParam } from '@/app/extension/[workspaceId]/search-params'
import { useExtensionComposer } from '@/app/extension/hooks/use-composer'
import ExtensionLoading from '@/app/extension/loading'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { ExtensionUnavailable } from '@/app/extension/unavailable'
import { OrganizationConversation } from '@/app/o/[organizationId]/components/organization-conversation'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { resourceParam, resourceUrlKeys } from '@/app/workspace/[workspaceId]/home/search-params'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useOrganizationSummary } from '@/hooks/queries/organization'

interface ExtensionOrganizationProps {
  context: OrganizationSurfaceContext
}

export function ExtensionOrganization({ context }: ExtensionOrganizationProps) {
  const access = useOrganizationSummary(context.organization.id)
  const history = useOrganizationMothershipChats(context.organization.id)
  const denied = [access.error, history.error].find(
    (error) => isApiClientError(error) && [401, 403, 404].includes(error.status)
  )
  if (isApiClientError(denied) && denied.status === 401) return <ExtensionSignIn />
  if (access.isPending) return <ExtensionLoading />
  if (denied || !access.data)
    return (
      <ExtensionUnavailable
        scope='organization'
        onRetry={() => {
          void access.refetch()
          void history.refetch()
        }}
      />
    )
  return (
    <OrganizationProvider context={context}>
      <SettingsLoader />
      <ExtensionOrganizationChat context={context} history={history} />
    </OrganizationProvider>
  )
}

interface ExtensionOrganizationChatProps extends ExtensionOrganizationProps {
  history: ReturnType<typeof useOrganizationMothershipChats>
}

function ExtensionOrganizationChat({ context, history }: ExtensionOrganizationChatProps) {
  const [, setResource] = useQueryState(resourceParam.key, {
    ...resourceParam.parser,
    ...resourceUrlKeys,
  })
  const [selectedChatId, setSelectedChatId] = useQueryState(
    extensionChatParam.key,
    extensionChatParam.parser
  )
  const [captureChatId, setCaptureChatId] = useState(selectedChatId)
  const [initialChatId, setInitialChatId] = useState(selectedChatId)
  const [composerKey, setComposerKey] = useState(generateId)
  if (captureChatId !== selectedChatId) {
    setCaptureChatId(selectedChatId)
    setInitialChatId(selectedChatId)
    setComposerKey(generateId())
  }
  const selectedChat = initialChatId
    ? history.data?.find((chat) => chat.id === initialChatId)
    : undefined
  if (initialChatId && !history.data && history.isPending) return <ExtensionLoading />
  if (initialChatId && !selectedChat)
    return <ExtensionUnavailable scope='chat' onRetry={() => void history.refetch()} />
  const requestMode = initialChatId ? selectedChat?.mode : context.canBuild ? 'agent' : 'assistant'
  if (!requestMode)
    return history.isFetching ? (
      <ExtensionLoading />
    ) : (
      <ExtensionUnavailable scope='chat' onRetry={() => void history.refetch()} />
    )
  if (requestMode === 'assistant' ? !context.searchAccess.memberScoped : !context.canBuild)
    return <ExtensionUnavailable scope='chat' />
  return (
    <ExtensionOrganizationConversation
      key={composerKey}
      context={context}
      history={history}
      scopeKey={composerKey}
      initialChatId={initialChatId ?? undefined}
      selectedChatId={selectedChatId ?? undefined}
      requestMode={requestMode}
      onSelectChat={(chatId) => {
        void setResource(null)
        void setSelectedChatId(chatId)
      }}
      onChatIdResolved={(chatId) => {
        setCaptureChatId(chatId)
        void setSelectedChatId(chatId)
      }}
    />
  )
}

interface ExtensionOrganizationConversationProps extends ExtensionOrganizationChatProps {
  scopeKey: string
  initialChatId?: string
  selectedChatId?: string
  requestMode: ChatRequestMode
  onSelectChat: (chatId: string | null) => void
  onChatIdResolved: (chatId: string) => void
}

function ExtensionOrganizationConversation({
  context,
  history,
  scopeKey,
  initialChatId,
  selectedChatId,
  requestMode,
  onSelectChat,
  onChatIdResolved,
}: ExtensionOrganizationConversationProps) {
  const composer = useExtensionComposer(scopeKey)
  const routes = organizationRoutes(context.organization.id)
  const appHref = selectedChatId
    ? requestMode === 'assistant'
      ? routes.searchChat(selectedChatId)
      : routes.chat(selectedChatId)
    : requestMode === 'assistant'
      ? routes.search
      : routes.home
  return (
    <OrganizationConversation
      chatId={initialChatId}
      requestMode={requestMode}
      panelOptions={{
        ...composer,
        draftNamespace: 'extension',
        onChatIdResolved,
        onNavigateToChat: onSelectChat,
        header: (
          <>
            <ExtensionHeader
              scopeName={context.organization.name}
              history={history}
              chatId={selectedChatId}
              onSelectChat={onSelectChat}
              appHref={appHref}
            />
            {composer.captureError && (
              <p role='alert' className='px-3 py-2 text-[var(--text-error)] text-caption'>
                {composer.captureError}
              </p>
            )}
          </>
        ),
      }}
    />
  )
}
