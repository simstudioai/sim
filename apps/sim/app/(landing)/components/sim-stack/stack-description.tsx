'use client'

import { Fragment } from 'react'
import { cn } from '@sim/emcn'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import { getStackLayerProgress } from '@/app/(landing)/components/sim-stack/stack-timeline'

interface StackDescriptionProps {
  active: number
  progress: number
  instant?: boolean
}

interface TypedCopyProps {
  text: string
  progress: number
  reduced: boolean
}

/** Reserve complete words so typing never shifts line breaks or announces individual letters. */
function TypedCopy({ text, progress, reduced }: TypedCopyProps) {
  let offset = 0
  return (
    <>
      <span className='sr-only'>{text}</span>
      <span aria-hidden='true'>
        {text.split(' ').map((word, wordIndex) => {
          const start = offset
          offset += word.length + 1
          return (
            <Fragment key={`${wordIndex}-${word}`}>
              {wordIndex > 0 && ' '}
              <span className='inline-block whitespace-nowrap'>
                {Array.from(word).map((character, index) => (
                  <span
                    key={`${index}-${character}`}
                    className={cn(
                      'transition-opacity duration-75 motion-reduce:transition-none',
                      (reduced ? progress > 0 : progress * text.length > start + index)
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  >
                    {character}
                  </span>
                ))}
              </span>
            </Fragment>
          )
        })}
      </span>
    </>
  )
}

interface DescriptionLayerProps extends StackDescriptionProps {
  reduced: boolean
}

function DescriptionLayer({ active, progress, reduced }: DescriptionLayerProps) {
  const present = useIsPresent()
  const layer = STACK_LAYERS[active]
  const { drawing } = getStackLayerProgress(progress, active)
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, filter: 'none' }}
      exit={{ opacity: 0, filter: reduced ? 'blur(0px)' : 'blur(6px)' }}
      transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
      data-stack-description={layer.id}
      aria-hidden={!present || drawing === 0}
      className='col-start-1 row-start-1'
    >
      <h3 className='text-[28px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.025em] max-xl:text-[24px]'>
        <TypedCopy text={layer.title} progress={drawing / 0.25} reduced={reduced} />
      </h3>
      <p className='mt-4 text-[14px] text-[var(--text-body)] leading-[1.6] max-xl:mt-3'>
        <TypedCopy
          text={layer.description}
          progress={reduced ? drawing : (drawing - 0.25) / 0.75}
          reduced={reduced}
        />
      </p>
    </motion.div>
  )
}

/** Retain outgoing copy long enough to soften its exit while the next engraving begins. */
export function StackDescription({ active, progress, instant = false }: StackDescriptionProps) {
  const reduced = useReducedMotion() ?? false
  return (
    <div className='grid max-w-[280px] max-xl:mx-auto max-xl:max-w-[340px]'>
      {instant ? (
        <DescriptionLayer active={active} progress={progress} reduced />
      ) : (
        <AnimatePresence initial={false} mode='wait'>
          <DescriptionLayer key={active} active={active} progress={progress} reduced={reduced} />
        </AnimatePresence>
      )}
    </div>
  )
}
