'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { DiscordIcon, GithubIcon, xIcon as XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import useIsMobile from '../hooks/useIsMobile'

interface FooterProps {
  onOpenTypeformLink: () => void
}

function Footer({ onOpenTypeformLink }: FooterProps) {
  const router = useRouter()
  const { isMobile, mounted } = useIsMobile()

  if (!mounted) {
    return <section className="w-full p-4 md:p-9 flex" />
  }

  // If on mobile, render without animations
  if (isMobile) {
    return (
      <section className="w-full p-4 md:p-9 flex">
        <div className="bg-[#2B2334] rounded-3xl flex flex-col p-6 sm:p-10 md:p-16 w-full">
          <div className="flex flex-col w-full h-full md:flex-row justify-between">
            {/* Left side content */}
            <div className="flex flex-col justify-between">
              <p className="max-w-lg leading-[1.1] text-[#B5A1D4] font-light md:text-6xl text-5xl">
                Ready to build AI faster and easier?
              </p>
              <div className="mt-4 md:mt-auto pt-4 md:pt-8">
                <Button
                  className="bg-[#B5A1D4] text-[#1C1C1C] w-fit hover:bg-[#bdaecb] transition-colors duration-500"
                  size={'lg'}
                  variant={'secondary'}
                  onClick={onOpenTypeformLink}
                >
                  Get Started
                </Button>
              </div>
            </div>

            {/* Right side content */}
            <div className="md:w-auto w-full flex flex-col gap-6 md:flex-row md:gap-16 md:items-end mt-8 md:mt-0 md:justify-end relative">
              {/* See repo button positioned absolutely to align with the top text - desktop only */}
              <div className="absolute top-0 right-0 md:block hidden">
                <Link
                  href="https://github.com/simstudioai/sim"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    className="bg-[#B5A1D4] text-[#1C1C1C] hover:bg-[#bdaecb] transition-colors duration-500 flex items-center gap-2"
                    size={'lg'}
                    variant={'secondary'}
                  >
                    <GithubIcon className="w-5 h-5" />
                    See repo
                  </Button>
                </Link>
              </div>

              {/* Links section - flex row on mobile, part of flex row in md */}
              <div className="flex flex-row justify-between md:justify-start w-full md:w-auto gap-4 md:gap-16">
                <div className="flex flex-col gap-2">
                  <Link
                    href={'https://docs.simstudio.ai/'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                  >
                    Docs
                  </Link>
                  <Link
                    href={'https://github.com/simstudioai/sim'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                  >
                    Contributors
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  <Link
                    href={'/terms'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                  >
                    Terms and Conditions
                  </Link>
                  <Link
                    href={'/privacy'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                  >
                    Privacy Policy
                  </Link>
                </div>
              </div>

              {/* Social icons */}
              <div className="flex md:justify-end items-center mt-4 md:mt-0">
                <div className="flex gap-4">
                  <Link
                    href={'https://github.com/simstudioai/sim'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex md:hidden text-2xl transition-all duration-500"
                  >
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 1024 1024"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
                        transform="scale(64)"
                        fill="#9E91AA"
                      />
                    </svg>
                  </Link>
                  <Link
                    href={'https://discord.gg/Hr4UWYEcTT'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xl transition-all duration-500"
                  >
                    <DiscordIcon className="fill-[#9E91AA] hover:fill-[#bdaecb] w-9 h-9 md:w-10 md:h-10" />
                  </Link>
                  <Link
                    href={'https://x.com/simstudioai'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xl transition-all duration-500"
                  >
                    <XIcon className="w-9 h-9 md:w-10 md:h-10 text-[#9E91AA] hover:text-[#bdaecb] transition-all duration-500" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <motion.section
      className="w-full p-4 md:p-9 flex"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
    >
      <motion.div
        className="bg-[#2B2334] rounded-3xl flex flex-col p-6 sm:p-10 md:p-16 w-full"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
      >
        <motion.div
          className="flex flex-col w-full h-full md:flex-row justify-between"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          {/* Left side content */}
          <div className="flex flex-col justify-between">
            <motion.p
              className="max-w-lg leading-[1.1] text-[#B5A1D4] font-light md:text-6xl text-5xl"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
            >
              Ready to build AI faster and easier?
            </motion.p>
            <motion.div
              className="mt-4 md:mt-auto pt-4 md:pt-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.22, ease: 'easeOut' }}
            >
              <Button
                className="bg-[#B5A1D4] text-[#1C1C1C] w-fit hover:bg-[#bdaecb] transition-colors duration-500"
                size={'lg'}
                variant={'secondary'}
                onClick={onOpenTypeformLink}
              >
                Get Started
              </Button>
            </motion.div>
          </div>

          {/* Right side content */}
          <motion.div
            className="md:w-auto w-full flex flex-col gap-6 md:flex-row md:gap-16 md:items-end mt-8 md:mt-0 md:justify-end relative"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.28, ease: 'easeOut' }}
          >
            {/* See repo button positioned absolutely to align with the top text - desktop only */}
            <motion.div
              className="absolute top-0 right-0 md:block hidden"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            >
              <Link
                href="https://github.com/simstudioai/sim"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  className="bg-[#B5A1D4] text-[#1C1C1C] hover:bg-[#bdaecb] transition-colors duration-500 flex items-center gap-2"
                  size={'lg'}
                  variant={'secondary'}
                >
                  <GithubIcon className="w-5 h-5" />
                  See repo
                </Button>
              </Link>
            </motion.div>

            {/* Links section - flex row on mobile, part of flex row in md */}
            <div className="flex flex-row justify-between md:justify-start w-full md:w-auto gap-4 md:gap-16">
              <motion.div
                className="flex flex-col gap-2"
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.7, delay: 0.32, ease: 'easeOut' }}
              >
                <Link
                  href={'https://docs.simstudio.ai/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                >
                  Docs
                </Link>
                <Link
                  href={'https://github.com/simstudioai/sim'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                >
                  Contributors
                </Link>
              </motion.div>
              <motion.div
                className="flex flex-col gap-2"
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.7, delay: 0.36, ease: 'easeOut' }}
              >
                <Link
                  href={'/terms'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                >
                  Terms and Conditions
                </Link>
                <Link
                  href={'/privacy'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl md:text-2xl text-[#9E91AA] font-light hover:text-[#bdaecb] transition-all duration-500"
                >
                  Privacy Policy
                </Link>
              </motion.div>
            </div>

            {/* Social icons */}
            <motion.div
              className="flex md:justify-end items-center mt-4 md:mt-0"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            >
              <div className="flex gap-4">
                <Link
                  href={'https://github.com/simstudioai/sim'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex md:hidden text-2xl transition-all duration-500"
                >
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 1024 1024"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
                      transform="scale(64)"
                      fill="#9E91AA"
                    />
                  </svg>
                </Link>
                <Link
                  href={'https://discord.gg/Hr4UWYEcTT'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xl transition-all duration-500"
                >
                  <DiscordIcon className="fill-[#9E91AA] hover:fill-[#bdaecb] w-9 h-9 md:w-10 md:h-10" />
                </Link>
                <Link
                  href={'https://x.com/simstudioai'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xl transition-all duration-500"
                >
                  <XIcon className="w-9 h-9 md:w-10 md:h-10 text-[#9E91AA] hover:text-[#bdaecb] transition-all duration-500" />
                </Link>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}

export default Footer
