'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu } from 'lucide-react'
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
import { useWindowSize } from './use-window-size'

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
  // Renamed for clarity
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
// --- End Framer Motion Variants ---

// Component for Navigation Links
const NavLinks = ({ mobile }: { mobile?: boolean }) => {
  const links = [
    // { href: "/", label: "Marketplace" },
    { href: '/', label: 'Docs' },
    { href: '/', label: 'Blog' },
    { href: '/', label: 'Contributors' },
  ]

  return (
    <>
      {links.map((link) => {
        const linkElement = (
          <motion.div variants={mobile ? mobileNavItemVariants : undefined} key={link.label}>
            <Link
              href={link.href}
              className="text-white/60 hover:text-white/100 text-base p-1.5 rounded-md transition-colors duration-200 block md:inline-block"
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
    </>
  )
}

export default function NavClient({ children }: { children: React.ReactNode }) {
  const { width } = useWindowSize()
  const isMobile = width !== undefined && width < 768 // Adjusted breakpoint to md
  const [isSheetOpen, setIsSheetOpen] = useState(false) // State for sheet open/close

  const router = useRouter()

  return (
    <nav className="absolute top-1 left-0 right-0 z-30 px-4 py-8">
      <div className="max-w-7xl mx-auto flex justify-between items-center relative">
        <div className="flex-1">{/* <div className="text-xl text-white">sim studio</div> */}</div>

        {!isMobile && (
          <motion.div
            className="flex items-center gap-4 px-2 py-1 bg-neutral-700/50 rounded-lg"
            variants={desktopNavContainerVariants}
            initial="hidden"
            animate="visible"
          >
            <NavLinks />
          </motion.div>
        )}
        {isMobile && <div className="flex-1"></div>}

        <div className="flex-1 flex justify-end">
          <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
            {!isMobile && (
              <>
                <div className="flex items-center">{children}</div>
                <Button
                  onClick={() => router.push('/login')}
                  className="bg-[#701ffc] hover:bg-[#802FFF] font-[420] text-base h-auto py-2 px-6 text-neutral-100 font-geist-sans transition-colors duration-200"
                >
                  Get Started
                </Button>
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
                        className="bg-neutral-900 border-l border-neutral-800 text-white w-[250px] sm:w-[300px] pt-12 p-6 flex flex-col h-full"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <SheetHeader className="mb-4 text-left">
                          <SheetTitle className="text-white">Menu</SheetTitle>
                        </SheetHeader>
                        <motion.div
                          className="flex flex-col gap-4 flex-grow"
                          variants={mobileNavItemsContainerVariants}
                          initial="hidden"
                          animate="visible"
                        >
                          <NavLinks mobile />
                          {children && (
                            <motion.div variants={mobileNavItemVariants}>
                              <SheetClose asChild>{children}</SheetClose>
                            </motion.div>
                          )}
                          <motion.div variants={mobileNavItemVariants} className="mt-auto">
                            <SheetClose asChild>
                              <Button
                                variant={'secondary'}
                                className="w-full bg-[#802FFF] hover:bg-[#6A27D9] font-[450] text-base text-neutral-100 font-geist-sans transition-colors duration-200"
                              >
                                <Link href={'/login'}>Get Started</Link>
                              </Button>
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
