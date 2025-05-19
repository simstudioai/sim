'use client'

import { motion } from 'framer-motion'
import { GithubIcon } from '@/components/icons'

interface HeaderLinksProps {
  stars: string
}

export default function HeaderLinks({ stars }: HeaderLinksProps) {
  return (
    <div className="flex items-center">
      <motion.a
        href="https://github.com/simstudioai/sim"
        className="flex items-center gap-1.5 text-foreground/80 hover:text-foreground/100 p-1 rounded-md transition-colors duration-200"
        aria-label="GitHub"
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut', delay: 0.1 }}
      >
        <GithubIcon className="w-[24px] h-[24px]" />
        <span className="text-sm font-medium hidden sm:inline">{stars}</span>
      </motion.a>
    </div>
  )
}
