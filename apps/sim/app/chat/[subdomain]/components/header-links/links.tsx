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
        className="flex items-center gap-1 text-foreground/70 hover:text-foreground transition-colors duration-200 rounded-md px-1.5 py-1 hover:bg-foreground/5"
        aria-label="GitHub"
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        whileHover={{ scale: 1.02 }}
      >
        <GithubIcon className="w-[18px] h-[18px]" />
        <span className="text-xs font-medium hidden sm:inline-block">{stars}</span>
      </motion.a>
    </div>
  )
}
