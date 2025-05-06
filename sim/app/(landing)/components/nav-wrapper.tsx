'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { getFormattedGitHubStars } from '../actions/github'
import GitHubStarsClient from './github-stars-client'
import NavClient from './nav-client'

interface NavWrapperProps {
  onOpenTypeformLink: () => void
}

export default function NavWrapper({ onOpenTypeformLink }: NavWrapperProps) {
  // Use a client-side component to wrap the navigation
  // This avoids trying to use server-side UA detection
  // which has compatibility challenges

  const pathname = usePathname()
  const [initialIsMobile, setInitialIsMobile] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  // Default to a reasonable number and update it later
  const [starCount, setStarCount] = useState('1.2k')

  useEffect(() => {
    // Set initial mobile state based on window width
    setInitialIsMobile(window.innerWidth < 768)

    // Slight delay to ensure smooth animations with other elements
    setTimeout(() => {
      setIsLoaded(true)
    }, 100)

    // Use server action to fetch stars
    getFormattedGitHubStars()
      .then((formattedStars) => {
        setStarCount(formattedStars)
      })
      .catch((err) => {
        console.error('Failed to fetch GitHub stars:', err)
      })
  }, [])

  return (
    <>
      <AnimatePresence mode="wait">
        {!isLoaded ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="absolute top-1 left-0 right-0 z-30 px-4 py-8"
          >
            <div className="max-w-7xl mx-auto flex justify-between items-center relative">
              <div className="flex-1"></div>
              <div className="flex-1 flex justify-end">
                <div className="w-[43px] h-[43px]"></div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="loaded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <NavClient
              initialIsMobile={initialIsMobile}
              currentPath={pathname}
              onContactClick={onOpenTypeformLink}
            >
              <GitHubStarsClient stars={starCount} />
            </NavClient>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
