'use client'

import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'

/**
 * ErrorMessageProps interface - defines the properties for the ErrorMessage component
 * @property {string | null} message - The error message to display, or null if no error
 */
interface ErrorMessageProps {
  message: string | null
}

/**
 * ErrorMessage component - Displays an error message with animation
 * Only renders when a message is provided, otherwise returns null
 * Uses Framer Motion for smooth entrance animation
 */
export function ErrorMessage({ message }: ErrorMessageProps) {
  // Don't render anything if there's no message
  if (!message) return null

  return (
    <motion.div
      className="mb-8 p-4 border border-red-200 bg-red-50 text-red-700 rounded-md"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <p className="flex items-center">
        <AlertCircle className="h-4 w-4 mr-2" />
        {message}
      </p>
    </motion.div>
  )
}
