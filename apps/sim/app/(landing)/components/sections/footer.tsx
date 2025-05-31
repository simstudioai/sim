'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DiscordIcon, GithubIcon, xIcon as XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth-client'
import { usePrefetchOnHover } from '../../utils/prefetch'
import useIsMobile from '../hooks/use-is-mobile'

function Footer() {
  const router = useRouter()
  const { isMobile, mounted } = useIsMobile()
  const { data: session, isPending } = useSession()
  const isAuthenticated = !isPending && !!session?.user

  const handleContributorsHover = usePrefetchOnHover()

  const handleNavigate = () => {
    if (typeof window !== 'undefined') {
      // Check if user has an active session
      if (isAuthenticated) {
        router.push('/w')
      } else {
        // Check if user has logged in before
        const hasLoggedInBefore =
          localStorage.getItem('has_logged_in_before') === 'true' ||
          document.cookie.includes('has_logged_in_before=true')

        if (hasLoggedInBefore) {
          // User has logged in before but doesn't have an active session
          router.push('/login')
        } else {
          // User has never logged in before
          router.push('/signup')
        }
      }
    }
  }

  if (!mounted) {
    return <section className='flex w-full p-4 md:p-9' />
  }

  // If on mobile, render without animations
  if (isMobile) {
    return (
      <section className='flex w-full p-4 md:p-9'>
        <div className='flex w-full flex-col rounded-3xl bg-[#2B2334] p-6 sm:p-10 md:p-16'>
          <div className='flex h-full w-full flex-col justify-between md:flex-row'>
            {/* Left side content */}
            <div className='flex flex-col justify-between'>
              <p className='max-w-lg font-light text-5xl text-[#B5A1D4] leading-[1.1] md:text-6xl'>
                Ready to build AI faster and easier?
              </p>
              <div className='mt-4 pt-4 md:mt-auto md:pt-8'>
                <Button
                  className='w-fit bg-[#B5A1D4] text-[#1C1C1C] transition-colors duration-500 hover:bg-[#bdaecb]'
                  size={'lg'}
                  variant={'secondary'}
                  onClick={handleNavigate}
                >
                  Get Started
                </Button>
              </div>
            </div>

            {/* Right side content */}
            <div className='relative mt-8 flex w-full flex-col gap-6 md:mt-0 md:w-auto md:flex-row md:items-end md:justify-end md:gap-16'>
              {/* See repo button positioned absolutely to align with the top text - desktop only */}
              <div className='absolute top-0 right-0 hidden md:block'>
                <Link
                  href='https://github.com/simstudioai/sim'
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <Button
                    className='flex items-center gap-2 bg-[#B5A1D4] text-[#1C1C1C] transition-colors duration-500 hover:bg-[#bdaecb]'
                    size={'lg'}
                    variant={'secondary'}
                  >
                    <GithubIcon className='h-5 w-5' />
                    See repo
                  </Button>
                </Link>
              </div>

              {/* Links section - flex row on mobile, part of flex row in md */}
              <div className='flex w-full flex-row justify-between gap-4 md:w-auto md:justify-start md:gap-16'>
                <div className='flex flex-col gap-2'>
                  <Link
                    href={'https://docs.simstudio.ai/'}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                  >
                    Docs
                  </Link>
                  <Link
                    href={'/contributors'}
                    className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                    onMouseEnter={handleContributorsHover}
                  >
                    Contributors
                  </Link>
                </div>
                <div className='flex flex-col gap-2'>
                  <Link
                    href={'/terms'}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                  >
                    Terms and Conditions
                  </Link>
                  <Link
                    href={'/privacy'}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                  >
                    Privacy Policy
                  </Link>
                </div>
              </div>

              {/* Social icons */}
              <div className='mt-4 flex items-center md:mt-0 md:justify-end'>
                <div className='flex gap-4'>
                  <Link
                    href={'https://github.com/simstudioai/sim'}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex text-2xl transition-all duration-500 md:hidden'
                  >
                    <svg
                      width='36'
                      height='36'
                      viewBox='0 0 1024 1024'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
                    >
                      <path
                        fillRule='evenodd'
                        clipRule='evenodd'
                        d='M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z'
                        transform='scale(64)'
                        fill='#9E91AA'
                      />
                    </svg>
                  </Link>
                  <Link
                    href={'https://discord.gg/Hr4UWYEcTT'}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-2xl transition-all duration-500'
                  >
                    <DiscordIcon className='h-9 w-9 fill-[#9E91AA] hover:fill-[#bdaecb] md:h-10 md:w-10' />
                  </Link>
                  <Link
                    href={'https://x.com/simstudioai'}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-2xl transition-all duration-500'
                  >
                    <XIcon className='h-9 w-9 text-[#9E91AA] transition-all duration-500 hover:text-[#bdaecb] md:h-10 md:w-10' />
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
      className='flex w-full p-4 md:p-9'
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
    >
      <motion.div
        className='flex w-full flex-col rounded-3xl bg-[#2B2334] p-6 sm:p-10 md:p-16'
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
      >
        <motion.div
          className='flex h-full w-full flex-col justify-between md:flex-row'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          {/* Left side content */}
          <div className='flex flex-col justify-between'>
            <motion.p
              className='max-w-lg font-light text-5xl text-[#B5A1D4] leading-[1.1] md:text-6xl'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
            >
              Ready to build AI faster and easier?
            </motion.p>
            <motion.div
              className='mt-4 pt-4 md:mt-auto md:pt-8'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.22, ease: 'easeOut' }}
            >
              <Button
                className='w-fit bg-[#B5A1D4] text-[#1C1C1C] transition-colors duration-500 hover:bg-[#bdaecb]'
                size={'lg'}
                variant={'secondary'}
                onClick={handleNavigate}
              >
                Get Started
              </Button>
            </motion.div>
          </div>

          {/* Right side content */}
          <motion.div
            className='relative mt-8 flex w-full flex-col gap-6 md:mt-0 md:w-auto md:flex-row md:items-end md:justify-end md:gap-16'
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.28, ease: 'easeOut' }}
          >
            {/* See repo button positioned absolutely to align with the top text - desktop only */}
            <motion.div
              className='absolute top-0 right-0 hidden md:block'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            >
              <Link
                href='https://github.com/simstudioai/sim'
                target='_blank'
                rel='noopener noreferrer'
              >
                <Button
                  className='flex items-center gap-2 bg-[#B5A1D4] text-[#1C1C1C] transition-colors duration-500 hover:bg-[#bdaecb]'
                  size={'lg'}
                  variant={'secondary'}
                >
                  <GithubIcon className='h-5 w-5' />
                  See repo
                </Button>
              </Link>
            </motion.div>

            {/* Links section - flex row on mobile, part of flex row in md */}
            <div className='flex w-full flex-row justify-between gap-4 md:w-auto md:justify-start md:gap-16'>
              <motion.div
                className='flex flex-col gap-2'
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.7, delay: 0.32, ease: 'easeOut' }}
              >
                <Link
                  href={'https://docs.simstudio.ai/'}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                >
                  Docs
                </Link>
                <Link
                  href={'/contributors'}
                  className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                  onMouseEnter={handleContributorsHover}
                >
                  Contributors
                </Link>
              </motion.div>
              <motion.div
                className='flex flex-col gap-2'
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.7, delay: 0.36, ease: 'easeOut' }}
              >
                <Link
                  href={'/terms'}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                >
                  Terms and Conditions
                </Link>
                <Link
                  href={'/privacy'}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='font-light text-[#9E91AA] text-xl transition-all duration-500 hover:text-[#bdaecb] md:text-2xl'
                >
                  Privacy Policy
                </Link>
              </motion.div>
            </div>

            {/* Social icons */}
            <motion.div
              className='mt-4 flex items-center md:mt-0 md:justify-end'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            >
              <div className='flex gap-4'>
                <Link
                  href={'https://github.com/simstudioai/sim'}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex text-2xl transition-all duration-500 md:hidden'
                >
                  <svg
                    width='36'
                    height='36'
                    viewBox='0 0 1024 1024'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      fillRule='evenodd'
                      clipRule='evenodd'
                      d='M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z'
                      transform='scale(64)'
                      fill='#9E91AA'
                    />
                  </svg>
                </Link>
                <Link
                  href={'https://discord.gg/Hr4UWYEcTT'}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-2xl transition-all duration-500'
                >
                  <DiscordIcon className='h-9 w-9 fill-[#9E91AA] hover:fill-[#bdaecb] md:h-10 md:w-10' />
                </Link>
                <Link
                  href={'https://x.com/simstudioai'}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-2xl transition-all duration-500'
                >
                  <XIcon className='h-9 w-9 text-[#9E91AA] transition-all duration-500 hover:text-[#bdaecb] md:h-10 md:w-10' />
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
