'use client'

import type { ReactNode } from 'react'
import { Modal } from '@sim/emcn/modal'
import { Surface } from '@sim/emcn-platform/surface'
import { createPortal } from 'react-dom'
import type { PageContextDialogProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/page-context'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'
import { formatTimestamp } from '@/platform/shared/time'

interface BodyDialogProps {
  /** Leaves what it shows out of session capture. */
  uncaptured?: boolean
  children: ReactNode
}

/**
 * Hosts a dialog at the document's root, as the legacy dialogs portal theirs. A native modal dialog
 * inside the chat's column or panel would go `inert` or undisplayed with it, leaving the page locked.
 * Render it only while open: it reads `document`.
 */
export function BodyDialog({ uncaptured, children }: BodyDialogProps) {
  return createPortal(
    <div className={uncaptured ? `ph-no-capture ${styles.dialogHost}` : styles.dialogHost}>
      <Surface detached>{children}</Surface>
    </div>,
    document.body
  )
}

interface MicrophoneHelpProps {
  onClose: () => void
}

/** The browser's recovery steps once microphone access is blocked. */
export function MicrophoneHelp({ onClose }: MicrophoneHelpProps) {
  return (
    <Modal
      open
      onOpenChange={onClose}
      title='Allow microphone access'
      description='Once microphone access is blocked, your browser requires you to change it from the site controls.'
      confirmLabel='Done'
    >
      <ol className={styles.helpSteps} data-type='T048'>
        <li>Open the site controls beside the address bar.</li>
        <li>Set Microphone access for this site to Allow.</li>
        <li>Reload the page if prompted, then try voice input again.</li>
      </ol>
      <p className={styles.helpNote} data-type='T048'>
        In Safari, open Safari Settings, then Websites, then Microphone.
      </p>
    </Modal>
  )
}

/**
 * What a chat captured from a page. Its trigger sits inside a message's paragraph, which could not
 * hold a dialog anyway, and it stays out of session capture.
 */
export function PageContextDialog({
  snapshot,
  title,
  hostname,
  isDraft,
  onClose,
}: PageContextDialogProps) {
  return (
    <BodyDialog uncaptured>
      <Modal open onOpenChange={onClose} title={title} confirmLabel='Done'>
        <div className={styles.pageContextMeta} data-type='T060'>
          <a href={snapshot.url} target='_blank' rel='noopener noreferrer' title={snapshot.url}>
            {hostname}
          </a>
          <time dateTime={snapshot.capturedAt}>
            {formatTimestamp(new Date(snapshot.capturedAt).getTime())}
          </time>
        </div>
        {snapshot.truncated && (
          <p className={styles.helpNote} data-type='T060'>
            Partial capture. Some page text is omitted.
          </p>
        )}
        <pre className={styles.pageContextText} data-type='T060'>
          {snapshot.text}
        </pre>
        {isDraft && (
          <p className={styles.helpNote} data-type='T060'>
            Saved in this chat when you send your message.
          </p>
        )}
      </Modal>
    </BodyDialog>
  )
}
