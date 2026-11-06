import styles from '@/platform/app/(shell)/_components/chat/conversation/conversation.module.css'

/** A conversation's frame while the route decides whether the viewer may open it. */
export function ConversationSkeleton() {
  return (
    <div className={styles.chat} role='status' aria-label='Loading conversation' aria-busy='true'>
      <header className={styles.header} data-desktop-drag='' />
      <div className={styles.reading} />
      <div className={styles.dock}>
        <div className={styles.dockInner}>
          <div className={styles.composerPlaceholder} />
        </div>
      </div>
    </div>
  )
}
