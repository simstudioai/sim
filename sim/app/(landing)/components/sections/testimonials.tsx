'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Marquee } from '@/app/(landing)/components/magicui/marquee'
import useIsMobile from '../hooks/useIsMobile'

const X_TESTIMONIALS = [
  {
    text: "Drag-and-drop AI workflows for devs who'd rather build agents than babysit them.",
    username: '@GithubProjects',
    viewCount: '90.4k',
    tweetUrl: 'https://x.com/GithubProjects/status/1906383555707490499',
    profileImage: 'https://pbs.twimg.com/profile_images/1679831765744259073/hoVtsOZ9_400x400.jpg',
  },
  {
    text: 'A very good looking agent workflow builder 🔥 and open source!',
    username: '@xyflowdev',
    viewCount: '2,771',
    tweetUrl: 'https://x.com/xyflowdev/status/1909501499719438670',
    profileImage: 'https://pbs.twimg.com/profile_images/1719655365011238912/RX4seDV2_400x400.jpg',
  },
  {
    text: "🚨 BREAKING: This startup just dropped the fastest way to build AI agents.\n\nThis Figma-like canvas to build agents will blow your mind.\n\nHere's why this is the best tool for building AI agents:",
    username: '@hasantoxr',
    viewCount: '508k',
    tweetUrl: 'https://x.com/hasantoxr/status/1912909502036525271',
    profileImage: 'https://pbs.twimg.com/profile_images/1906880573140070400/wYssvs_v_400x400.jpg',
  },
  {
    text: 'omfggggg this is the zapier of agent building\n\ni always believed that building agents and using ai should not be limited to technical people. i think this solves just that\n\nthe fact that this is also open source makes me so optimistic about the future of building with ai :)))\n\ncongrats @karabegemir & @typingwala !!!',
    username: '@nizzyabi',
    viewCount: '6,269',
    tweetUrl: 'https://x.com/nizzyabi/status/1907864421227180368',
    profileImage: '/nizzy.jpg',
  },
  {
    text: "One of the best products I've seen in the space, and the hustle and grind I've seen from @karabegemir and @typingwala is insane. Sim Studio is positioned to build something game-changing, and there's no better team for the job.\n\nCongrats on the launch 🚀 🎊 great things ahead!",
    username: '@firestorm776',
    viewCount: '956',
    tweetUrl: 'https://x.com/firestorm776/status/1907896097735061598',
    profileImage: 'https://pbs.twimg.com/profile_images/1507556591419207685/sNvH2OGg_400x400.jpg',
  },
  {
    text: 'lfgg got access to @simstudioai via @zerodotemail 😎',
    username: '@nizzyabi',
    viewCount: '1,585',
    tweetUrl: 'https://x.com/nizzyabi/status/1910482357821595944',
    profileImage: '/nizzy.jpg',
  },
  {
    text: 'Feels like we\'re finally getting a "Photoshop moment" for AI devs—visual, intuitive, and fast enough to keep up with ideas mid-flow.',
    username: '@syamrajk',
    viewCount: '2,643',
    tweetUrl: 'https://x.com/syamrajk/status/1912911980110946491',
    profileImage: 'https://pbs.twimg.com/profile_images/1912907755339522048/EeyUbije_400x400.jpg',
  },
  {
    text: "🚨 BREAKING: This startup just dropped the fastest way to build AI agents.\n\nThis Figma-like canvas to build agents will blow your mind.\n\nHere's why this is the best tool for building AI agents:",
    username: '@lazukars',
    viewCount: '47.4k',
    tweetUrl: 'https://x.com/lazukars/status/1913136390503600575',
    profileImage: 'https://pbs.twimg.com/profile_images/1721431652964904961/T5j6xmxi_400x400.png',
  },
  {
    text: 'The use cases are endless. Great work @simstudioai',
    username: '@daniel_zkim',
    viewCount: '103',
    tweetUrl: 'https://x.com/daniel_zkim/status/1907891273664782708',
    profileImage: 'https://pbs.twimg.com/profile_images/1895341179186692096/XXdBixf6_400x400.jpg',
  },
]

// Split the testimonials into two rows
const firstRowTestimonials = X_TESTIMONIALS.slice(0, Math.ceil(X_TESTIMONIALS.length / 2))
const secondRowTestimonials = X_TESTIMONIALS.slice(Math.ceil(X_TESTIMONIALS.length / 2))

function Testimonials() {
  const { isMobile, mounted } = useIsMobile()

  if (!mounted) {
    return (
      <section className="relative flex flex-col py-10 sm:py-12 md:py-16 w-full overflow-hidden" />
    )
  }

  return (
    <section className="relative flex flex-col py-10 sm:py-12 md:py-16 w-full overflow-hidden will-change-[opacity,transform] animation-container">
      <div className="flex flex-col items-center gap-3 sm:gap-5 pb-6 sm:pb-8 md:pb-10 px-4">
        {isMobile ? (
          <p className="text-white font-medium tracking-normal text-5xl text-center">Loved by</p>
        ) : (
          <motion.p
            className="text-white font-medium tracking-normal text-5xl text-center"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
          >
            Loved by
          </motion.p>
        )}
      </div>

      <div className="flex flex-col space-y-2 sm:space-y-3 md:mt-0 mt-2">
        {/* First Row of X Posts */}
        <div className="w-full flex flex-col text-white animate-fade-up [animation-delay:400ms] opacity-0 will-change-[opacity,transform] animation-container">
          <Marquee className="w-full flex [--duration:40s]" pauseOnHover={true}>
            {firstRowTestimonials.map((card, index) => (
              <motion.div
                key={`first-row-${index}`}
                className="bg-[#121212] border border-[#333] p-2 sm:p-3 flex flex-col gap-2 rounded-lg cursor-pointer min-w-[280px] sm:min-w-[320px] max-w-[340px] sm:max-w-[380px] mx-0.5"
                whileHover={{ scale: 1.02, boxShadow: '0 8px 32px 0 rgba(80, 60, 120, 0.18)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                onClick={() =>
                  card.tweetUrl && window.open(card.tweetUrl, '_blank', 'noopener,noreferrer')
                }
              >
                <div className="flex flex-col gap-1">
                  <p className="text-white text-sm sm:text-base font-medium">{card.text}</p>
                </div>
                <div className="flex justify-between items-center mt-auto">
                  <div className="flex gap-1.5 sm:gap-2 items-center">
                    {card.profileImage && (
                      <img
                        src={card.profileImage}
                        alt={`${card.username} profile`}
                        className="w-6 h-6 sm:w-8 sm:h-8 rounded-full object-cover border border-[#333]"
                      />
                    )}
                    <div className="flex items-center">
                      <span className="text-xs sm:text-sm font-medium text-white/80">@</span>
                      <p className="text-xs sm:text-sm font-medium text-white/80">
                        {card.username.replace('@', '')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <p className="text-[10px] sm:text-xs text-white/60">{card.viewCount} views</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </Marquee>
        </div>

        {/* Second Row of X Posts */}
        <div className="w-full flex flex-col text-white animate-fade-up [animation-delay:600ms] opacity-0 will-change-[opacity,transform] animation-container">
          <Marquee className="w-full flex [--duration:40s]" pauseOnHover={true}>
            {secondRowTestimonials.map((card, index) => (
              <motion.div
                key={`second-row-${index}`}
                className="bg-[#121212] border border-[#333] p-2 sm:p-3 flex flex-col gap-2 rounded-lg cursor-pointer min-w-[280px] sm:min-w-[320px] max-w-[340px] sm:max-w-[380px] mx-0.5"
                whileHover={{ scale: 1.02, boxShadow: '0 8px 32px 0 rgba(80, 60, 120, 0.18)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                onClick={() =>
                  card.tweetUrl && window.open(card.tweetUrl, '_blank', 'noopener,noreferrer')
                }
              >
                <div className="flex flex-col gap-1">
                  <p className="text-white text-sm sm:text-base font-medium">{card.text}</p>
                </div>
                <div className="flex justify-between items-center mt-auto">
                  <div className="flex gap-1.5 sm:gap-2 items-center">
                    {card.profileImage && (
                      <img
                        src={card.profileImage}
                        alt={`${card.username} profile`}
                        className="w-6 h-6 sm:w-8 sm:h-8 rounded-full object-cover border border-[#333]"
                      />
                    )}
                    <div className="flex items-center">
                      <span className="text-xs sm:text-sm font-medium text-white/80">@</span>
                      <p className="text-xs sm:text-sm font-medium text-white/80">
                        {card.username.replace('@', '')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <p className="text-[10px] sm:text-xs text-white/60">{card.viewCount} views</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </Marquee>
        </div>
      </div>
    </section>
  )
}

export default Testimonials
