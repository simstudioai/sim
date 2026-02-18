'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Badge } from '@/components/emcn'

export default function Templates() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  })

  const inset = useTransform(scrollYProgress, [0.1, 0.35], [0, 16])
  const borderRadius = useTransform(scrollYProgress, [0.1, 0.35], [0, 4])

  return (
    <section
      ref={sectionRef}
      id='templates'
      aria-labelledby='templates-heading'
      className='mt-[40px] bg-[#F6F6F6]'
    >
      <motion.div style={{ padding: inset }}>
        <motion.div
          style={{ borderRadius }}
          className='bg-[#1C1C1C] px-[80px] pt-[120px] pb-[80px]'
        >
          <div className='flex flex-col items-start gap-[20px]'>
            <Badge
              variant='blue'
              size='md'
              dot
              className='bg-[rgba(42,187,248,0.1)] font-season text-[#2ABBF8] uppercase tracking-[0.02em]'
            >
              Templates
            </Badge>

            <h2
              id='templates-heading'
              className='font-[430] font-season text-[40px] text-white leading-[100%] tracking-[-0.02em]'
            >
              Ready-made AI templates.
            </h2>

            <p className='max-w-[463px] font-[430] font-season text-[#F6F6F0]/50 text-[16px] leading-[125%] tracking-[0.02em]'>
              Jump-start workflows with ready-made templates for any team—fully editable for your
              stack.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}
