"use client";

import { DiscordIcon, GithubIcon, xIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import React from 'react'
import { motion } from 'framer-motion'

function Footer() {
  return (
    <motion.section
      className='w-full p-9 flex'
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
    >
      <motion.div
        className='bg-[#2B2334] rounded-3xl flex flex-col gap-10 p-16 w-full'
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
      >
        <motion.div
          className='flex flex-col gap-8 w-full'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          <motion.p
            className='max-w-lg leading-[1.1] text-[#B5A1D4] font-light md:text-6xl text-5xl'
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
          >
            Ready to build AI faster and easier?
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.22, ease: 'easeOut' }}
          >
            <Button className='bg-[#B5A1D4] text-[#1C1C1C] w-fit' size={"lg"} variant={"secondary"}>
                <Link href={"/login"}>
                  Get Started
                </Link>
            </Button>
          </motion.div>
        </motion.div>
        <motion.div
          className='w-full flex justify-between md:flex-row gap-16 md:gap-0 flex-col'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.28, ease: 'easeOut' }}
        >
          <div className='md:flex md:mt-auto hidden'>
            <svg width="75" height="82" viewBox="0 0 75 82" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M57.5688 30.2847H16.6423C9.10788 30.2847 3 36.3925 3 43.9269V64.3901C3 71.9245 9.10788 78.0324 16.6423 78.0324H57.5688C65.103 78.0324 71.2109 71.9245 71.2109 64.3901V43.9269C71.2109 36.3925 65.103 30.2847 57.5688 30.2847Z" stroke="#9E91AA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M37.1087 16.6423C40.8759 16.6423 43.9299 13.5883 43.9299 9.82113C43.9299 6.05392 40.8759 3 37.1087 3C33.3415 3 30.2876 6.05392 30.2876 9.82113C30.2876 13.5883 33.3415 16.6423 37.1087 16.6423Z" stroke="#9E91AA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M37.107 18.4946V27.9227M26.876 57.556V50.7349M47.3391 50.7349V57.556" stroke="#9E91AA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <div className='md:flex-row flex-col flex gap-8 md:gap-16'>
            <motion.div
              className='flex flex-col gap-2'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.32, ease: 'easeOut' }}
            >
              <Link href={"/marketplace"} className='text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500'>
                Marketplace
              </Link>
              <Link href={"/docs"} className='text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500'>
                Docs
              </Link>
              <Link href={"/blogs"} className='text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500'>
                Blogs
              </Link>
            </motion.div>
            <motion.div
              className='flex flex-col gap-2'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.36, ease: 'easeOut' }}
            >
              <Link href={"/tos"} className='text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500'>
                Terms and Condition
              </Link>
              <Link href={"/privacy"} className='text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500'>
                Privacy Policy
              </Link>
              <Link href={"/cookies"} className='text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500'>
                Cookie Policy
              </Link>
            </motion.div>
            <motion.div
              className='flex flex-col justify-between h-full gap-4 md:gap-0'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            >
              <Button className='bg-[#B5A1D4] text-[#1C1C1C] w-fit hidden md:flex' size={"lg"} variant={"secondary"}>
                See Repo <GithubIcon/>
              </Button>
              <div className='flex gap-4'>
                <Link href={"/github"} className='flex md:hidden text-2xl transition-all duration-500'>
                <svg width="40" height="40" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" transform="scale(64)" fill="#9E91AA"/>
                </svg>


                </Link>
                <Link href={"/discord"} className='text-2xl transition-all duration-500'>
                  <DiscordIcon className='fill-[#9E91AA] hover:fill-[#bdaecb] w-10 h-10'/>
                </Link>
                <Link href={"/x"} className='text-2xl transition-all duration-500'>
                  <svg xmlns="http://www.w3.org/2000/svg" className='fill-[#9E91AA] hover:fill-[#bdaecb] w-10 h-10' width="48" height="48" fill="currentColor" viewBox="0 0 1200 1227"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                </Link>
              </div>
            </motion.div>
          </div>
          <div className='flex md:hidden'>
                <svg width="75" height="82" viewBox="0 0 75 82" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M57.5688 30.2847H16.6423C9.10788 30.2847 3 36.3925 3 43.9269V64.3901C3 71.9245 9.10788 78.0324 16.6423 78.0324H57.5688C65.103 78.0324 71.2109 71.9245 71.2109 64.3901V43.9269C71.2109 36.3925 65.103 30.2847 57.5688 30.2847Z" stroke="#9E91AA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M37.1087 16.6423C40.8759 16.6423 43.9299 13.5883 43.9299 9.82113C43.9299 6.05392 40.8759 3 37.1087 3C33.3415 3 30.2876 6.05392 30.2876 9.82113C30.2876 13.5883 33.3415 16.6423 37.1087 16.6423Z" stroke="#9E91AA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M37.107 18.4946V27.9227M26.876 57.556V50.7349M47.3391 50.7349V57.556" stroke="#9E91AA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
          </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}

export default Footer