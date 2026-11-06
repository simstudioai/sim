'use client'

import type { ChatPanelAppearance } from '@/app/workspace/[workspaceId]/home/components/chat-resource-panel'
import type { ChatAppearance } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import { PageContextDialog } from '@/platform/app/(shell)/_components/conversation/dialogs'
import { ResponseActions } from '@/platform/app/(shell)/_components/conversation/response-actions'
import { ShareDialog } from '@/platform/app/(shell)/_components/conversation/share-dialog'
import {
  ComposerPlaceholder,
  TranscriptPlaceholder,
} from '@/platform/app/(shell)/_components/conversation/skeletons'
import hostBridge from '@/platform/design-system/styles/host-bridge.module.css'

/** The design's look for the legacy chat and panel deep inside a page conversation. */
export const CONVERSATION_APPEARANCE: { chat: ChatAppearance; panel: ChatPanelAppearance } = {
  chat: {
    userBubbleClassName: styles.userBubble,
    responseActionsClassName: styles.responseActions,
    sourcesPopoverClassName: `${hostBridge.tokens} ${styles.sourcesPopover}`,
    renderResponseActions: (actions) => <ResponseActions {...actions} />,
    renderPageContextDialog: (dialog) => <PageContextDialog {...dialog} />,
    loadingTranscript: <TranscriptPlaceholder />,
    loadingComposer: <ComposerPlaceholder />,
  },
  panel: {
    panelClassName: styles.panel,
    tabsClassName: styles.tabs,
    sourcesClassName: `${styles.palette} ${styles.sources}`,
    renderShareDialog: (dialog) => <ShareDialog {...dialog} />,
  },
}
