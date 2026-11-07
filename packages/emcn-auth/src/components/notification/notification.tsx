'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AuthFormMessage } from '#auth/components/feedback/feedback'
import styles from '#auth/components/notification/notification.module.css'
import { useAuthPortal } from '#auth/components/root/context'

interface AuthNotificationProps {
  children: ReactNode
  type: 'success' | 'error'
}
/** Feedback stays inside the Auth portal and does not inherit the app toast theme. */
export function AuthNotification({ children, type }: AuthNotificationProps) {
  const portal = useAuthPortal()
  const [visible, setVisible] = useState(true)
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    if (hovered) return
    const timer = setTimeout(() => setVisible(false), 5000)
    return () => clearTimeout(timer)
  }, [hovered])
  if (!portal || !visible) return null
  return createPortal(
    <div
      className={styles.notification}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <AuthFormMessage type={type}>{children}</AuthFormMessage>
    </div>,
    portal
  )
}
