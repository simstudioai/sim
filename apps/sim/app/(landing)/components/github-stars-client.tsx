'use client'

import { motion } from 'framer-motion'
import { GithubIcon } from '@/components/icons'

interface GitHubStarsClientProps {
  stars: string
}

export default function GitHubStarsClient({ stars }: GitHubStarsClientProps) {
  return (
    <motion.a
      href="https://github.com/simstudioai/sim"
      className="flex items-center gap-2 text-white/80 hover:text-white/100 p-1.5 rounded-md transition-colors duration-200"
      aria-label="GitHub"
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.3 }}
    >
      <GithubIcon className="w-[20px] h-[20px]" />
      <span className="text-base font-medium">{stars}</span>
    </motion.a>
  )
}
