'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { usePrefetchOnHover } from '../utils/prefetch'
import { whitelabelConfig } from '@/lib/whitelabel'

// --- Framer Motion Variants ---
const desktopNavContainerVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.2,
      duration: 0.3,
    },
  },
}

const mobileSheetContainerVariants = {
  hidden: { x: '100%' },
  visible: {
    x: 0,
    transition: { duration: 0.3 },
  },
  exit: {
    x: '100%',
    transition: { duration: 0.2 },
  },
}

const mobileNavItemsContainerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

const mobileNavItemVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3 },
  },
}

const mobileButtonVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 },
  },
}
// --- End Framer Motion Variants ---

// Component for Navigation Links
const NavLinks = ({
  mobile,
  currentPath,
  onContactClick,
}: {
  mobile?: boolean
  currentPath?: string
  onContactClick?: () => void
}) => {
  const navigationLinks = [
    // { href: "/", label: "Marketplace" },
    ...(currentPath !== '/' ? [{ href: '/', label: 'Home' }] : []),
    { href: 'https://docs.simstudio.ai/', label: 'Docs', external: true },
    // { href: '/', label: 'Blog' },
    { href: '/contributors', label: 'Contributors' },
  ]

  const handleContributorsHover = usePrefetchOnHover()

  // Common CSS class for navigation items
  const navItemClass = `text-white/60 hover:text-white/100 text-base ${
    mobile ? 'p-2.5 text-lg font-medium text-left' : 'p-1.5'
  } rounded-md transition-colors duration-200 block md:inline-block`

  return (
    <>
      {navigationLinks.map((link) => {
        const linkElement = (
          <motion.div variants={mobile ? mobileNavItemVariants : undefined} key={link.label}>
            <Link
              href={link.href}
              className={navItemClass}
              onMouseEnter={link.label === 'Contributors' ? handleContributorsHover : undefined}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {link.label}
            </Link>
          </motion.div>
        )

        // Wrap the motion.div with SheetClose if mobile
        return mobile ? (
          <SheetClose asChild key={link.label}>
            {linkElement}
          </SheetClose>
        ) : (
          linkElement
        )
      })}

      {/* Enterprise button with the same action as contact */}
      {onContactClick &&
        (mobile ? (
          <SheetClose asChild key='enterprise'>
            <motion.div variants={mobileNavItemVariants}>
              <Link
                href='https://form.typeform.com/to/jqCO12pF'
                target='_blank'
                rel='noopener noreferrer'
                className={navItemClass}
              >
                Enterprise
              </Link>
            </motion.div>
          </SheetClose>
        ) : (
          <motion.div variants={mobile ? mobileNavItemVariants : undefined} key='enterprise'>
            <Link
              href='https://form.typeform.com/to/jqCO12pF'
              target='_blank'
              rel='noopener noreferrer'
              className={navItemClass}
            >
              Enterprise
            </Link>
          </motion.div>
        ))}
    </>
  )
}

interface NavClientProps {
  children: React.ReactNode
  initialIsMobile?: boolean
  currentPath?: string
  onContactClick?: () => void
}

export default function NavClient({
  children,
  initialIsMobile,
  currentPath,
  onContactClick,
}: NavClientProps) {
  const [isMobile, setIsMobile] = useState(initialIsMobile)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleContactClick = () => {
    setIsMenuOpen(false)
    onContactClick?.()
  }

  const mobileNavContainerVariants = {
    hidden: { opacity: 0, y: -20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.3,
        ease: 'easeOut' as const,
      },
    },
  }

  const desktopNavContainerVariants = {
    hidden: { opacity: 0, y: -10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.3,
        ease: 'easeOut' as const,
      },
    },
  }

  return (
    <nav className='absolute top-1 right-0 left-0 z-30 px-4 py-8'>
      <div className='relative mx-auto flex max-w-7xl items-center justify-between'>
        {!isMobile && (
          <div className='flex flex-1 items-center'>
            <div className='inline-block'>
              <Link href='/' className='inline-flex'>
                <Image src='/sim.svg' alt='247 Workforce Logo' width={42} height={42} />
              </Link>
            </div>
          </div>
        )}

        {!isMobile && (
          <motion.div
            className='flex items-center gap-4 rounded-lg bg-neutral-700/50 px-2 py-1'
            variants={desktopNavContainerVariants}
            initial='hidden'
            animate='visible'
            transition={{ delay: 0.2, duration: 0.3, ease: 'easeOut' }}
          >
            <NavLinks currentPath={currentPath} onContactClick={onContactClick} />
          </motion.div>
        )}
        {isMobile && <div className='flex-1' />}

        {isMobile && (
          <motion.div
            variants={mobileNavContainerVariants}
            initial='hidden'
            animate='visible'
            transition={{ delay: 0.1, duration: 0.3, ease: 'easeOut' }}
          >
            <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='relative h-10 w-10 rounded-lg bg-neutral-700/50 text-white hover:bg-neutral-600/50'
                >
                  <Menu className='h-5 w-5' />
                  <span className='sr-only'>Toggle menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side='right'
                className='w-full border-neutral-800 bg-neutral-900/95 p-0 backdrop-blur-sm sm:w-80'
              >
                <div className='flex h-full flex-col'>
                  {/* Header */}
                  <div className='flex items-center justify-between border-b border-neutral-800 p-6'>
                    <Link href='/' className='inline-flex' onClick={() => setIsMenuOpen(false)}>
                      <Image src='/sim.svg' alt='247 Workforce Logo' width={32} height={32} />
                    </Link>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => setIsMenuOpen(false)}
                      className='h-8 w-8 text-neutral-400 hover:text-white'
                    >
                      <X className='h-4 w-4' />
                      <span className='sr-only'>Close menu</span>
                    </Button>
                  </div>

                  {/* Mobile Navigation */}
                  <div className='flex-1 overflow-y-auto p-6'>
                    <div className='space-y-6'>
                      <NavLinks currentPath={currentPath} onContactClick={handleContactClick} />
                    </div>
                  </div>

                  {/* Footer */}
                  <div className='border-t border-neutral-800 p-6'>
                    <div className='flex items-center justify-between text-sm text-neutral-400'>
                      <span>© 2024 {whitelabelConfig.companyName}</span>
                      <div className='flex items-center gap-4'>
                        <Link
                          href={whitelabelConfig.githubUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='hover:text-white'
                        >
                          GitHub
                        </Link>
                        <Link
                          href={whitelabelConfig.discordUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='hover:text-white'
                        >
                          Discord
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </motion.div>
        )}
      </div>
    </nav>
  )
}
