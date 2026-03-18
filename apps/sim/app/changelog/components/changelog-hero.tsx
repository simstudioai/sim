'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BookOpen, Github, Rss } from 'lucide-react'
import Link from 'next/link'

const EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const
const STAGGER = 0.2
const DURATION = 0.4
const Y_OFFSET = 12

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

export function ChangelogHero() {
  const shouldReduceMotion = useReducedMotion()

  return (
    <section className='relative overflow-hidden border-b border-[#2A2A2A] pb-10 pt-12'>
      <div
        className='pointer-events-none absolute inset-0 opacity-50'
        aria-hidden='true'
        style={{
          backgroundImage:
            'radial-gradient(circle at 2px 2px, rgba(255, 255, 255, 0.04) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />
      <motion.div
        className='relative z-10 mx-auto max-w-5xl px-6'
        variants={containerVariants}
        initial={shouldReduceMotion ? 'visible' : 'hidden'}
        animate='visible'
      >
        <div className='flex flex-col items-start'>
          <motion.div
            variants={itemVariants}
            className='mb-6 inline-flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#999]'
          >
            <span className='inline-block h-2 w-2 flex-shrink-0 bg-[#FFCC02]' aria-hidden='true' />
            Sim / Changelog
          </motion.div>
          <motion.h1
            variants={itemVariants}
            className='mb-3 max-w-3xl text-balance font-[430] text-[40px] leading-[1.1] tracking-[-0.02em] text-[#ECECEC] sm:text-[56px] md:text-[64px]'
          >
            What&apos;s new in <span className='text-[#666]'>Sim.</span>
          </motion.h1>
          <motion.p
            variants={itemVariants}
            className='max-w-2xl text-[18px] leading-relaxed tracking-[0.02em] text-[#999]'
          >
            Stay up-to-date with the latest features, improvements, and bug fixes.
          </motion.p>
          <motion.div variants={itemVariants} className='mt-8 flex flex-wrap items-center gap-3'>
            <Link
              href='https://github.com/simstudioai/sim/releases'
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-2 rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] px-[9px] py-[5px] text-[13.5px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
            >
              <Github className='h-4 w-4' />
              View on GitHub
            </Link>
            <Link
              href='https://docs.sim.ai'
              className='inline-flex items-center gap-2 rounded-[5px] border border-[#3d3d3d] px-[9px] py-[5px] text-[13.5px] text-[#ECECEC] transition-colors hover:bg-[#2A2A2A]'
            >
              <BookOpen className='h-4 w-4' />
              Documentation
            </Link>
            <Link
              href='/changelog.xml'
              className='inline-flex items-center gap-2 rounded-[5px] border border-[#3d3d3d] px-[9px] py-[5px] text-[13.5px] text-[#ECECEC] transition-colors hover:bg-[#2A2A2A]'
            >
              <Rss className='h-4 w-4' />
              RSS Feed
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}
