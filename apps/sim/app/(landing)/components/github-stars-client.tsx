'use client'

import { motion } from 'framer-motion'
import { GithubIcon } from '@/components/icons'

interface GitHubStarsClientProps {
  stars: string
}

export default function GitHubStarsClient({ stars }: GitHubStarsClientProps) {
  return (
    <motion.a
      href='https://github.com/simstudioai/sim'
      className='flex items-center gap-2 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:text-foreground'
      aria-label='GitHub'
      target='_blank'
      rel='noopener noreferrer'
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.3 }}
    >
      <GithubIcon className='h-4 w-4' />
      <span className='font-medium text-sm'>{stars}</span>
    </motion.a>
  )
}
