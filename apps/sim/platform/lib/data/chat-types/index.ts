/**
 * The hook's own shapes that Platform models carry through a view untouched. Types only, so they
 * erase at build: a change to one fails type-check here, and no legacy code enters a view.
 */

export type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
export type { FileAttachmentForApi } from '@/lib/mothership/chat/types'
export type { SearchResource } from '@/lib/mothership/generated/resources'
export type { CredentialItemData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/parse'
export type { ChatContext } from '@/stores/panel'
