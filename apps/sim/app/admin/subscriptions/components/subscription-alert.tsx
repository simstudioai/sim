'use client'

import { useState } from 'react'
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from 'lucide-react'

export type AlertType = 'success' | 'error' | 'warning' | 'info' | null

interface SubscriptionAlertProps {
  type: AlertType
  message: string
  onClose: () => void
}

export function SubscriptionAlert({ type, message, onClose }: SubscriptionAlertProps) {
  if (!type) return null

  const getAlertStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-green-50 dark:bg-green-900/20',
          border: 'border-green-200 dark:border-green-800',
          text: 'text-green-800 dark:text-green-200',
          icon: <CheckCircleIcon className="h-5 w-5 text-green-500" />,
        }
      case 'error':
        return {
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
          text: 'text-red-800 dark:text-red-200',
          icon: <AlertTriangleIcon className="h-5 w-5 text-red-500" />,
        }
      case 'warning':
        return {
          bg: 'bg-amber-50 dark:bg-amber-900/20',
          border: 'border-amber-200 dark:border-amber-800',
          text: 'text-amber-800 dark:text-amber-200',
          icon: <AlertTriangleIcon className="h-5 w-5 text-amber-500" />,
        }
      case 'info':
      default:
        return {
          bg: 'bg-blue-50 dark:bg-blue-900/20',
          border: 'border-blue-200 dark:border-blue-800',
          text: 'text-blue-800 dark:text-blue-200',
          icon: <InfoIcon className="h-5 w-5 text-blue-500" />,
        }
    }
  }

  const styles = getAlertStyles()

  return (
    <div
      className={`${styles.bg} ${styles.border} ${styles.text} rounded-lg border p-4 mb-4 flex items-start`}
      role="alert"
    >
      <div className="mr-3 flex-shrink-0">{styles.icon}</div>
      <div className="flex-1">{message}</div>
      <button onClick={onClose} className="ml-auto flex-shrink-0" aria-label="Close alert">
        <XIcon className="h-5 w-5 opacity-70 hover:opacity-100" />
      </button>
    </div>
  )
}

// Hook to manage alert state
export function useSubscriptionAlert() {
  const [alert, setAlert] = useState<{
    show: boolean
    type: AlertType
    message: string
  }>({
    show: false,
    type: null,
    message: '',
  })

  const hideAlert = () => {
    setAlert((prev) => ({ ...prev, show: false }))
  }

  const showAlert = (type: AlertType, message: string) => {
    setAlert({
      show: true,
      type,
      message,
    })

    // Auto-hide after 5 seconds
    setTimeout(hideAlert, 5000)
  }

  const successAlert = (message: string) => showAlert('success', message)
  const errorAlert = (message: string) => showAlert('error', message)
  const warningAlert = (message: string) => showAlert('warning', message)
  const infoAlert = (message: string) => showAlert('info', message)

  return {
    alert,
    hideAlert,
    showAlert,
    successAlert,
    errorAlert,
    warningAlert,
    infoAlert,
  }
}
