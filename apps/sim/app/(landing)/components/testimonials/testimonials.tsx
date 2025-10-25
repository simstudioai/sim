'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { inter } from '@/app/fonts/inter/inter'

interface Testimonial {
  text: string
  name: string
  username: string
  viewCount: string
  tweetUrl: string
  profileImage: string
}

const allTestimonials: Testimonial[] = [
  {
    text: "🚨 BREAKING: This startup just dropped the fastest way to build AI agents.\n\nThis Figma-like canvas to build agents will blow your mind.\n\nHere's why this is the best tool for building AI agents:",
    name: 'Hasan Toor',
    username: '@hasantoxr',
    viewCount: '515k',
    tweetUrl: 'https://x.com/hasantoxr/status/1912909502036525271',
    profileImage: '/twitter/hasan.jpg',
  },
  {
    text: "Drag-and-drop AI workflows for devs who'd rather build agents than babysit them.",
    name: 'GitHub Projects',
    username: '@GithubProjects',
    viewCount: '90.4k',
    tweetUrl: 'https://x.com/GithubProjects/status/1906383555707490499',
    profileImage: '/twitter/github-projects.jpg',
  },
  {
    text: "🚨 BREAKING: This startup just dropped the fastest way to build AI agents.\n\nThis Figma-like canvas to build agents will blow your mind.\n\nHere's why this is the best tool for building AI agents:",
    name: 'Ryan Lazuka',
    username: '@lazukars',
    viewCount: '47.4k',
    tweetUrl: 'https://x.com/lazukars/status/1913136390503600575',
    profileImage: '/twitter/lazukars.png',
  },
  {
    text: 'omfggggg this is the zapier of agent building\n\ni always believed that building agents and using ai should not be limited to technical people. i think this solves just that\n\nthe fact that this is also open source makes me so optimistic about the future of building with ai :)))\n\ncongrats @karabegemir & @typingwala !!!',
    name: 'nizzy',
    username: '@nizzyabi',
    viewCount: '6,269',
    tweetUrl: 'https://x.com/nizzyabi/status/1907864421227180368',
    profileImage: '/twitter/nizzy.jpg',
  },
  {
    text: 'A very good looking agent workflow builder 🔥 and open source!',
    name: 'xyflow',
    username: '@xyflowdev',
    viewCount: '3,246',
    tweetUrl: 'https://x.com/xyflowdev/status/1909501499719438670',
    profileImage: '/twitter/xyflow.jpg',
  },
  {
    text: "One of the best products I've seen in the space, and the hustle and grind I've seen from @karabegemir and @typingwala is insane. Sim is positioned to build something game-changing, and there's no better team for the job.\n\nCongrats on the launch 🚀 🎊 great things ahead!",
    name: 'samarth',
    username: '@firestorm776',
    viewCount: '1,256',
    tweetUrl: 'https://x.com/firestorm776/status/1907896097735061598',
    profileImage: '/twitter/samarth.jpg',
  },
  {
    text: 'lfgg got access to @simstudioai via @zerodotemail 😎',
    name: 'nizzy',
    username: '@nizzyabi',
    viewCount: '1,762',
    tweetUrl: 'https://x.com/nizzyabi/status/1910482357821595944',
    profileImage: '/twitter/nizzy.jpg',
  },
  {
    text: 'Feels like we\'re finally getting a "Photoshop moment" for AI devs—visual, intuitive, and fast enough to keep up with ideas mid-flow.',
    name: 'Syamraj K',
    username: '@syamrajk',
    viewCount: '2,784',
    tweetUrl: 'https://x.com/syamrajk/status/1912911980110946491',
    profileImage: '/twitter/syamrajk.jpg',
  },
  {
    text: 'The use cases are endless. Great work @simstudioai',
    name: 'Daniel Kim',
    username: '@daniel_zkim',
    viewCount: '103',
    tweetUrl: 'https://x.com/daniel_zkim/status/1907891273664782708',
    profileImage: '/twitter/daniel.jpg',
  },
]

export default function Testimonials() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  const extendedTestimonials = [...allTestimonials, ...allTestimonials]

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) {
        setIsTransitioning(true)
        setCurrentIndex((prevIndex) => prevIndex + 1)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [isPaused])

  useEffect(() => {
    if (currentIndex >= allTestimonials.length) {
      setTimeout(() => {
        setIsTransitioning(false)
        setCurrentIndex(0)
      }, 500)
    }
  }, [currentIndex])

  const getTransformValue = () => {
    // Each card unit (card + separator) takes exactly 25% width
    return `translateX(-${currentIndex * 25}%)`
  }

  return (
    <section
      id='testimonials'
      className={`flex hidden h-[150px] items-center sm:block ${inter.variable}`}
      aria-label='Social proof testimonials'
    >
      <div className='relative mx-auto h-full w-full max-w-[1289px] pl-[2px]'>
        <div
          className='relative h-full w-full overflow-hidden'
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div
            className={`flex h-full ${isTransitioning ? 'transition-transform duration-500 ease-in-out' : ''}`}
            style={{
              transform: getTransformValue(),
            }}
          >
            {extendedTestimonials.map((tweet, absoluteIndex) => {
              // Always show separator except for the very last card in the extended array
              const showSeparator = absoluteIndex < extendedTestimonials.length - 1

              return (
                /* Card unit wrapper - exactly 25% width including separator */
                <div key={`${absoluteIndex}`} className='flex h-full w-1/4 flex-shrink-0'>
                  {/* Tweet container */}
                  <div
                    className='group flex h-full w-full cursor-pointer flex-col px-[12px] py-[12px] transition-all duration-100 hover:bg-[#0A0A0A] sm:px-[14px]'
                    onClick={() => window.open(tweet.tweetUrl, '_blank', 'noopener,noreferrer')}
                  >
                    {/* Top section with profile info */}
                    <div className='flex items-start justify-between'>
                      <div className='flex items-start gap-2'>
                        {/* Profile image */}
                        <Image
                          src={tweet.profileImage}
                          alt={`${tweet.username} profile`}
                          width={34}
                          height={34}
                          className='h-[34px] w-[34px] rounded-full object-cover'
                          quality={75}
                          loading='lazy'
                        />
                        {/* Name and username stacked */}
                        <div className='flex flex-col'>
                          <span className='font-[500] text-gray-900 text-sm transition-colors duration-300 group-hover:text-white'>
                            {tweet.name}
                          </span>
                          <span className='text-gray-500 text-xs transition-colors duration-300 group-hover:text-white/80'>
                            {tweet.username}
                          </span>
                        </div>
                      </div>
                      {/* View count in top right */}
                      <span className='text-gray-400 text-xs transition-colors duration-300 group-hover:text-white/70'>
                        {tweet.viewCount} views
                      </span>
                    </div>

                    {/* Tweet content below with padding */}
                    <p
                      className={`${inter.className} mt-2 line-clamp-4 font-[380] text-[#0A0A0A] text-[13px] leading-[1.3] transition-colors duration-300 group-hover:text-white`}
                    >
                      {tweet.text}
                    </p>
                  </div>

                  {/* Full height vertical separator line */}
                  {showSeparator && (
                    <div className='relative h-full flex-shrink-0'>
                      <svg
                        width='2'
                        height='100%'
                        viewBox='0 0 2 200'
                        preserveAspectRatio='none'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                        className='h-full'
                      >
                        {/* Vertical line */}
                        <path d='M1 0V200' stroke='#E7E4EF' strokeWidth='2' />
                      </svg>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
