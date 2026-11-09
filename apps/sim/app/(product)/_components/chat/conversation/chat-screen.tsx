import type { ReactNode } from 'react'
import styles from '@/app/(product)/_components/chat/conversation/conversation.module.css'

/** A chat page's main landmark, adding no box so the conversation and its panel fill the pane. */
export function ChatScreen({ children }: { children: ReactNode }) {
  return <main className={styles.screen}>{children}</main>
}
