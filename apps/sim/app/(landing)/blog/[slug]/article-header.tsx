'use client'

import { motion, useReducedMotion } from 'framer-motion'

const EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const
const STAGGER = 0.15
const DURATION = 0.35
const Y_OFFSET = 10

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: Y_OFFSET },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION, ease: EASE_OUT_QUINT },
  },
}

export function ArticleHeaderMotion({ children }: { children: React.ReactNode }) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      variants={containerVariants}
      initial={shouldReduceMotion ? 'visible' : 'hidden'}
      animate='visible'
    >
      {children}
    </motion.div>
  )
}

export function ArticleHeaderItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  )
}
