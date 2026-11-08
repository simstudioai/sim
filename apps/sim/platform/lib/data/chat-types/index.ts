/**
 * The hook's own shapes that Platform models carry through a view untouched. Types only, so they
 * erase at build: a change to one fails type-check here, and no legacy code enters a view.
 */

export type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
export type { CredentialItemData } from '@/lib/mothership/chat/special-tags'
export type { FileAttachmentForApi } from '@/lib/mothership/chat/types'
export type { SearchResource } from '@/lib/mothership/generated/resources'
export type { ChatContext } from '@/stores/panel'
