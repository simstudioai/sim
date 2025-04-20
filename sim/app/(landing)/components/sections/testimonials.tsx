"use client";

import React from 'react'
import {motion} from 'framer-motion'
import { Marquee } from '@/components/magicui/marquee';

const TESTIMONIAL_CARDS = [
  {
    "text": "just tried simstudio.ai and wow it&apos;s a game changer for building ai agents 🧠 the workflows are so smooth and i love the light theme aesthetic. def recommend for devs!",
    "username": "@codewithmaya"
  },
  
  {
    "text": "OMG SimStudio.ai is 🔥🔥!! built my first AI agent in like 30 mins and the router features are insane. also that purple #802FFF vibe is so sleek. y&apos;all need to check this out asap!",
    "username": "@emirkarabeg"
  },

  {
    "text": "been playing with simstudio.ai for a few days and i&apos;m obsessed. the function chaining and step monitoring in workflows make debugging a breeze. 10/10 for any dev building ai stuff! 🙌",
    "username": "@emirthedev"
  },

  {
    "text": "SimStudio is the best thing to happen to my AI workflow. The UI is clean, the integrations are seamless, and the support is top notch.",
    "username": "@aiwizard"
  },

  {
    "text": "I built a production-ready agent in a weekend. The docs are clear and the visual workflow builder is next level.",
    "username": "@buildwithsam"
  },

  {
    "text": "The router and function blocks are so flexible. I can finally orchestrate complex logic without writing glue code everywhere.",
    "username": "@logicloop"
  },

  {
    "text": "SimStudio&apos;s agent memory and tool integrations are a killer combo. My team is shipping faster than ever.",
    "username": "@devflow"
  },
]

function Testimonials() {
  return (
    <section
      className='flex flex-col py-20 w-full gap-16'
    >
      <div className='flex flex-col items-center gap-7'>
        <motion.p
          className='text-white font-medium tracking-normal text-5xl text-center'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
        >
          A platform you can rely on
        </motion.p>
        <motion.p
          className='text-white/60 text-xl tracking-normal max-w-md font-light text-center'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          Join thousands of developers building smarter AI agents, supported by industry-leading founders who believe in our vision.
        </motion.p>
      </div>

      <div className='w-full flex flex-col gap-4 text-white'>
        <Marquee className='w-full flex gap-4 [--duration:20s]' pauseOnHover={true}>
          {TESTIMONIAL_CARDS.map((card, index) => (
            <motion.div
              key={index}
              className='bg-[#8E8492] border border-[#7B7080] p-4 flex flex-col gap-4 rounded-lg cursor-pointer'
              whileHover={{ scale: 1.045, boxShadow: '0 8px 32px 0 rgba(80, 60, 120, 0.18)' }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <p className='max-w-80 text-black/70 text-base'>
                {card.text}
              </p>
              <div className='flex gap-2 items-center mt-auto'>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 1200 1227"><path fill="#000" d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                <p className='text-sm font-medium text-black'>
                  {card.username}
                </p>
              </div>
            </motion.div>
          ))}
        </Marquee>
        <Marquee className='w-full flex gap-4 [--duration:20s]' pauseOnHover={true} reverse>
          {TESTIMONIAL_CARDS.map((card, index) => (
            <motion.div
              key={`reverse-${index}`}
              className='bg-[#8E8492] border border-[#7B7080] p-4 flex flex-col gap-4 rounded-lg cursor-pointer'
              whileHover={{ scale: 1.045, boxShadow: '0 8px 32px 0 rgba(80, 60, 120, 0.18)' }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <p className='max-w-80 text-black/70 text-base'>
                {card.text}
              </p>
              <div className='flex gap-2 items-center mt-auto'>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 1200 1227"><path fill="#000" d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                <p className='text-sm font-medium text-black'>
                  {card.username}
                </p>
              </div>
            </motion.div>
          ))}
        </Marquee>
      </div>
    </section>
  )
}

export default Testimonials