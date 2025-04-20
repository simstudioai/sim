"use client"

import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

function Blogs() {
  return (
    <motion.section
      className='flex flex-col py-20 w-full gap-16 px-8 md:px-16 lg:px-28 xl:px-32'
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay: 0.01, ease: 'easeOut' }}
    >
      <div className='flex flex-col gap-7'>
        <motion.p
          className='text-white font-medium tracking-normal text-5xl'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
        >
          Insights for building<br/>smarter Agents
        </motion.p>
        <motion.p
          className='text-white/60 text-xl tracking-normal max-w-md font-light'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          Stay ahead with the latest tips, updates, and best practices for AI agent development.
        </motion.p>
      </div>

      <div className='w-full flex flex-col gap-12 md:grid md:grid-cols-2 lg:grid-cols-3 md:grid-rows-1'>
        <motion.div className='flex flex-col gap-12' initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}>
          <BlogCard
            href='/blog/test'
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai&apos;s unified API and workflows."
            date={new Date("25 April 2025")}
            author='Emir Ayaz'
            authorRole='Designer'
            avatar='/static/sim.png'
            type='Agents'
            readTime='6'
          />
          <BlogCard
            href='/blog/test'
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai&apos;s unified API and workflows."
            date={new Date("25 April 2025")}
            author='Emir Ayaz'
            authorRole='Designer'
            avatar='/static/sim.png'
            type='Agents'
            readTime='6'
          />
        </motion.div>
        <motion.div className='flex flex-col gap-12' initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay: 0.22, ease: 'easeOut' }}>
          <BlogCard
            href='/blog/test'
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai&apos;s unified API and workflows."
            date={new Date("25 April 2025")}
            author='Emir Ayaz'
            authorRole='Designer'
            avatar='/static/sim.png'
            type='Agents'
            readTime='6'
            image='/static/hero.png'
          />
          <BlogCard
            href='/blog/test'
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai&apos;s unified API and workflows."
            author='Emir Ayaz'
            authorRole='Designer'
            avatar='/static/sim.png'
            type='Agents'
            readTime='6'
          />
        </motion.div>
        <motion.div className='hidden lg:flex flex-col gap-12' initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay: 0.26, ease: 'easeOut' }}>
          <BlogCard
            href='/blog/test'
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai&apos;s unified API and workflows."
            date={new Date("25 April 2025")}
            author='Emir Ayaz'
            authorRole='Designer'
            avatar='/static/sim.png'
            type='Agents'
            readTime='6'
          />
          <BlogCard
            href='/blog/test'
            title="How to Build an Agent in 5 Steps with SimStudio.ai"
            description="Learn how to create a fully functional AI agent using SimStudio.ai&apos;s unified API and workflows."
            date={new Date("25 April 2025")}
            author='Emir Ayaz'
            authorRole='Designer'
            avatar='/static/sim.png'
            type='Functions'
            readTime='6'
          />
        </motion.div>
      </div>
    </motion.section>
  )
}

type BlogCardProps = {
  href: string,
  title: string,
  description?: string,
  date?: Date,
  avatar?: string,
  author: string,
  authorRole?: string,
  type: string,
  readTime?: string,
  image?: string,
}

const blogConfig = {
  agents: "#802efc",
  functions: "#FC2E31",
  workflows: "#2E8CFC",
  // ADD MORE
}

const BlogCard = ({href, image, title, description, date, avatar, author, authorRole, type, readTime}: BlogCardProps) => {
  return (
    <Link href={href}>
      <div
        className='p-8 bg-[#101010] border border-[#606060]/40 rounded-3xl flex flex-col transition-all duration-500 hover:bg-[#202020]'
      >
        {image ? 
          <Image src={image} alt='Image' width={2000} height={2000} className='w-full h-max aspect-video rounded-xl'/>
          : <></>
        }
        {
          date ? (
            <p className='text-[#BBBBBB]/70 tracking-tight text-base font-light pb-5'>
              {date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          ) : <></>
        }
        <div className='flex flex-col gap-6'>
          <p className='text-2xl lg:text-3xl font-medium text-white/80 leading-[1.2] tracking-normal max-w-96'>
            {title}
          </p>
          <p className='text-lg text-white/60 leading-[1.5] font-light'>
            {description}
          </p>
        </div>
        <div className='pt-16 flex flex-col gap-6'>
          <div className='flex gap-4 items-center'>
            {avatar ? 
              <Image src={avatar} alt='Avatar' width={64} height={64} className='w-16 h-16 rounded-full'/>
              : <></>
            }

            <div className='flex flex-col gap-0'>
              <p className='text-xl font-medium text-white/90'>
                {author}
              </p>
              <p className='text-base font-normal text-white/60'>
                {authorRole}
              </p>
            </div>
          </div>

          <div className='flex gap-5 items-center'>
            <div
              className='px-2 py-1 rounded-lg'
              style={{
                background: blogConfig[type.toLowerCase() as keyof typeof blogConfig] ?? "#333"
              }}
            >
              <p className='text-white text-base font-light'>
                {type}
              </p>
            </div>
            <p className='font-light text-base text-white/60'>
              {readTime} min-read
            </p>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default Blogs