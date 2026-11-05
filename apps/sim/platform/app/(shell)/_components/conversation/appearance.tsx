'use client'

import type { OrganizationConversationAppearance } from '@/app/o/[organizationId]/components/organization-conversation'
import { COMPOSER_CHROME } from '@/platform/app/(shell)/_components/conversation/composer-chrome'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import {
  ComposerPlaceholder,
  TranscriptPlaceholder,
} from '@/platform/app/(shell)/_components/conversation/skeletons'

/** The design's look for the shared conversation: the same at every organization destination. */
export const CONVERSATION_APPEARANCE: OrganizationConversationAppearance = {
  composerChrome: COMPOSER_CHROME,
  threadClassName: `${styles.palette} ${styles.thread}`,
  chat: {
    userBubbleClassName: styles.userBubble,
    responseActionsClassName: styles.responseActions,
    sourcesPopoverClassName: styles.sourcesPopover,
    loadingTranscript: <TranscriptPlaceholder />,
    loadingComposer: <ComposerPlaceholder />,
  },
  panel: {
    panelClassName: styles.panel,
    tabsClassName: styles.tabs,
    sourcesClassName: `${styles.palette} ${styles.sources}`,
  },
}
