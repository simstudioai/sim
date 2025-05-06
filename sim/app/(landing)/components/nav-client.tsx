'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('NavClient')

// --- Framer Motion Variants ---
const desktopNavContainerVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.2,
      duration: 0.3,
      ease: 'easeOut',
    },
  },
}

const mobileSheetContainerVariants = {
  hidden: { x: '100%' },
  visible: {
    x: 0,
    transition: { duration: 0.3, ease: 'easeInOut' },
  },
  exit: {
    x: '100%',
    transition: { duration: 0.2, ease: 'easeIn' },
  },
}

const mobileNavItemsContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.1, // Delay before starting stagger
      staggerChildren: 0.08, // Stagger delay between items
    },
  },
}

const mobileNavItemVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
}

const mobileButtonVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: 'easeOut' },
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
    { href: 'https://github.com/simstudioai/sim', label: 'Contributors', external: true },
  ]

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
          <SheetClose asChild key="enterprise">
            <motion.div variants={mobileNavItemVariants}>
              <Link
                href="https://form.typeform.com/to/jqCO12pF"
                target="_blank"
                rel="noopener noreferrer"
                className={navItemClass}
              >
                Enterprise
              </Link>
            </motion.div>
          </SheetClose>
        ) : (
          <motion.div variants={mobile ? mobileNavItemVariants : undefined} key="enterprise">
            <Link
              href="https://form.typeform.com/to/jqCO12pF"
              target="_blank"
              rel="noopener noreferrer"
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
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(initialIsMobile ?? false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()

    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Handle initial loading state - don't render anything that could cause layout shift
  // until we've measured the viewport
  if (!mounted) {
    return (
      <nav className="absolute top-1 left-0 right-0 z-30 px-4 py-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center relative">
          <div className="flex-1">
            <div className="w-[32px] h-[32px]"></div>
          </div>
          <div className="flex-1 flex justify-end">
            <div className="w-[43px] h-[43px]"></div>
          </div>
        </div>
      </nav>
    )
  }

  return (
    <nav className="absolute top-1 left-0 right-0 z-30 px-4 py-8">
      <div className="max-w-7xl mx-auto flex justify-between items-center relative">
        {!isMobile && (
          <div className="flex-1 flex items-center">
            <div className="inline-block">
              <Link href="/" className="inline-flex">
                <Image src="/sim.svg" alt="Sim Logo" width={42} height={42} />
              </Link>
            </div>
          </div>
        )}

        {!isMobile && (
          <motion.div
            className="flex items-center gap-4 px-2 py-1 bg-neutral-700/50 rounded-lg"
            variants={desktopNavContainerVariants}
            initial="hidden"
            animate="visible"
          >
            <NavLinks currentPath={currentPath} onContactClick={onContactClick} />
          </motion.div>
        )}
        {isMobile && <div className="flex-1"></div>}

        <div className="flex-1 flex justify-end items-center">
          <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
            {!isMobile && (
              <>
                <div className="flex items-center">{children}</div>
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut', delay: 0.4 }}
                >
                  <Link
                    href="https://form.typeform.com/to/jqCO12pF"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button className="bg-[#701ffc] hover:bg-[#802FFF] h-[43px] font-medium text-base py-2 px-6 text-neutral-100 font-geist-sans transition-colors duration-200">
                      Contact
                    </Button>
                  </Link>
                </motion.div>
              </>
            )}

            {isMobile && (
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    className="p-2 rounded-md text-white hover:bg-neutral-700/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle menu</span>
                  </motion.button>
                </SheetTrigger>
                <AnimatePresence>
                  {isSheetOpen && (
                    <motion.div
                      key="sheet-content"
                      variants={mobileSheetContainerVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="fixed inset-y-0 right-0 z-50"
                    >
                      <SheetContent
                        side="right"
                        className="bg-[#0C0C0C] border-l border-[#181818] text-white w-[280px] sm:w-[320px] pt-6 p-6 flex flex-col h-full shadow-xl [&>button]:hidden"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <SheetHeader className="sr-only">
                          <SheetTitle>Navigation Menu</SheetTitle>
                        </SheetHeader>
                        <motion.div
                          className="flex flex-col gap-5 flex-grow"
                          variants={mobileNavItemsContainerVariants}
                          initial="hidden"
                          animate="visible"
                        >
                          <NavLinks
                            mobile
                            currentPath={currentPath}
                            onContactClick={onContactClick}
                          />
                          {children && (
                            <motion.div variants={mobileNavItemVariants}>
                              <SheetClose asChild>{children}</SheetClose>
                            </motion.div>
                          )}
                          <motion.div variants={mobileButtonVariants} className="mt-auto pt-6">
                            <SheetClose asChild>
                              <Link
                                href="https://form.typeform.com/to/jqCO12pF"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Button className="w-full bg-[#701ffc] hover:bg-[#802FFF] font-medium py-6 text-base text-white shadow-lg shadow-[#701ffc]/20 transition-colors duration-200">
                                  Contact
                                </Button>
                              </Link>
                            </SheetClose>
                          </motion.div>
                        </motion.div>
                      </SheetContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Sheet>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
