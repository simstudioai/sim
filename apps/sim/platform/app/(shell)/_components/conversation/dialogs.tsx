'use client'

import { createPortal } from 'react-dom'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import type { RenderPageContextDialog } from '@/app/workspace/[workspaceId]/home/components/message-content/components/page-context'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import { Modal } from '@/platform/design-system/components'

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

type PageContextDialogProps = Parameters<RenderPageContextDialog>[0]

/**
 * What a chat captured from a page. Portalled because its trigger sits inside a message's paragraph,
 * which cannot hold a dialog, and kept out of session capture as the legacy dialog is.
 */
export function PageContextDialog({
  snapshot,
  title,
  hostname,
  isDraft,
  onClose,
}: PageContextDialogProps) {
  return createPortal(
    <div className={`ph-no-capture ${styles.dialogHost}`}>
      <RedesignSurface>
        <Modal open onOpenChange={onClose} title={title} confirmLabel='Done'>
          <div className={styles.pageContextMeta} data-type='T060'>
            <a href={snapshot.url} target='_blank' rel='noopener noreferrer' title={snapshot.url}>
              {hostname}
            </a>
            <time dateTime={snapshot.capturedAt}>
              {new Date(snapshot.capturedAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
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
      </RedesignSurface>
    </div>,
    document.body
  )
}
