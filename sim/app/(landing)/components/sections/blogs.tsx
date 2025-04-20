'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { BlogCard } from '../blog-card'

function Blogs() {
  return (
    <motion.section
      className="flex flex-col py-20 w-full gap-16 px-8 md:px-16 lg:px-28 xl:px-32"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay: 0.01, ease: 'easeOut' }}
    >
      <div className="flex flex-col gap-7">
        <motion.p
          className="text-white font-medium tracking-normal text-5xl"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
        >
          Insights for building
          <br />
          smarter Agents
        </motion.p>
        <motion.p
          className="text-white/60 text-xl tracking-normal max-w-md font-light"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          Stay ahead with the latest tips, updates, and best practices for AI agent development.
        </motion.p>
      </div>

      <div className="w-full flex flex-col gap-12 md:grid md:grid-cols-2 lg:grid-cols-3 md:grid-rows-1">
        <motion.div
          className="flex flex-col gap-12"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
        >
          <BlogCard
            href="/blog/test"
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows."
            date={new Date('25 April 2025')}
            author="Emir Ayaz"
            authorRole="Designer"
            avatar="/static/sim.png"
            type="Agents"
            readTime="6"
          />
          <BlogCard
            href="/blog/test"
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows."
            date={new Date('25 April 2025')}
            author="Emir Ayaz"
            authorRole="Designer"
            avatar="/static/sim.png"
            type="Agents"
            readTime="6"
          />
        </motion.div>
        <motion.div
          className="flex flex-col gap-12"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.22, ease: 'easeOut' }}
        >
          <BlogCard
            href="/blog/test"
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows."
            date={new Date('25 April 2025')}
            author="Emir Ayaz"
            authorRole="Designer"
            avatar="/static/sim.png"
            type="Agents"
            readTime="6"
            image="/static/hero.png"
          />
          <BlogCard
            href="/blog/test"
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows."
            author="Emir Ayaz"
            authorRole="Designer"
            avatar="/static/sim.png"
            type="Agents"
            readTime="6"
          />
        </motion.div>
        <motion.div
          className="hidden lg:flex flex-col gap-12"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.26, ease: 'easeOut' }}
        >
          <BlogCard
            href="/blog/test"
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows."
            date={new Date('25 April 2025')}
            author="Emir Ayaz"
            authorRole="Designer"
            avatar="/static/sim.png"
            type="Agents"
            readTime="6"
          />
          <BlogCard
            href="/blog/test"
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows."
            date={new Date('25 April 2025')}
            author="Emir Ayaz"
            authorRole="Designer"
            avatar="/static/sim.png"
            type="Functions"
            readTime="6"
          />
        </motion.div>
      </div>
    </motion.section>
  )
}

export default Blogs
