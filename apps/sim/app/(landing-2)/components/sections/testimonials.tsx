'use client'

import { motion } from 'framer-motion'
import { getAssetUrl } from '@/lib/utils'
import useIsMobile from '@/app/(landing-2)/components/hooks/use-is-mobile'
import { Marquee } from '@/app/(landing-2)/components/magicui/marquee'

interface Testimonial {
  text: string
  username: string
  viewCount: string
  tweetUrl: string
  profileImage: string
}

const X_TESTIMONIALS: Testimonial[] = [
  {
    text: "Drag-and-drop AI workflows for devs who'd rather build agents than babysit them.",
    username: '@GithubProjects',
    viewCount: '90.4k',
    tweetUrl: 'https://x.com/GithubProjects/status/1906383555707490499',
    profileImage: getAssetUrl('twitter/github-projects.jpg'),
  },
  {
    text: 'A very good looking agent workflow builder 🔥 and open source!',
    username: '@xyflowdev',
    viewCount: '3,246',
    tweetUrl: 'https://x.com/xyflowdev/status/1909501499719438670',
    profileImage: getAssetUrl('twitter/xyflow.jpg'),
  },
  {
    text: "🚨 BREAKING: This startup just dropped the fastest way to build AI agents.\n\nThis Figma-like canvas to build agents will blow your mind.\n\nHere's why this is the best tool for building AI agents:",
    username: '@hasantoxr',
    viewCount: '515k',
    tweetUrl: 'https://x.com/hasantoxr/status/1912909502036525271',
    profileImage: getAssetUrl('twitter/hasan.jpg'),
  },
  {
    text: 'omfggggg this is the zapier of agent building\n\ni always believed that building agents and using ai should not be limited to technical people. i think this solves just that\n\nthe fact that this is also open source makes me so optimistic about the future of building with ai :)))\n\ncongrats @karabegemir & @typingwala !!!',
    username: '@nizzyabi',
    viewCount: '6,269',
    tweetUrl: 'https://x.com/nizzyabi/status/1907864421227180368',
    profileImage: getAssetUrl('twitter/nizzy.jpg'),
  },
  {
    text: "One of the best products I've seen in the space, and the hustle and grind I've seen from @karabegemir and @typingwala is insane. Sim is positioned to build something game-changing, and there's no better team for the job.\n\nCongrats on the launch 🚀 🎊 great things ahead!",
    username: '@firestorm776',
    viewCount: '956',
    tweetUrl: 'https://x.com/firestorm776/status/1907896097735061598',
    profileImage: getAssetUrl('twitter/samarth.jpg'),
  },
  {
    text: 'lfgg got access to @simstudioai via @zerodotemail 😎',
    username: '@nizzyabi',
    viewCount: '1,585',
    tweetUrl: 'https://x.com/nizzyabi/status/1910482357821595944',
    profileImage: getAssetUrl('twitter/nizzy.jpg'),
  },
  {
    text: 'Feels like we\'re finally getting a "Photoshop moment" for AI devs—visual, intuitive, and fast enough to keep up with ideas mid-flow.',
    username: '@syamrajk',
    viewCount: '2,643',
    tweetUrl: 'https://x.com/syamrajk/status/1912911980110946491',
    profileImage: getAssetUrl('twitter/syamrajk.jpg'),
  },
  {
    text: "🚨 BREAKING: This startup just dropped the fastest way to build AI agents.\n\nThis Figma-like canvas to build agents will blow your mind.\n\nHere's why this is the best tool for building AI agents:",
    username: '@lazukars',
    viewCount: '47.4k',
    tweetUrl: 'https://x.com/lazukars/status/1913136390503600575',
    profileImage: getAssetUrl('twitter/lazukars.png'),
  },
  {
    text: 'The use cases are endless. Great work @simstudioai',
    username: '@daniel_zkim',
    viewCount: '103',
    tweetUrl: 'https://x.com/daniel_zkim/status/1907891273664782708',
    profileImage: getAssetUrl('twitter/daniel.jpg'),
  },
]

// Split the testimonials into two rows
const firstRowTestimonials = X_TESTIMONIALS.slice(0, Math.ceil(X_TESTIMONIALS.length / 2))
const secondRowTestimonials = X_TESTIMONIALS.slice(Math.ceil(X_TESTIMONIALS.length / 2))

// Testimonial Row Component
interface TestimonialRowProps {
  testimonials: Testimonial[]
  rowKey: string
}

function TestimonialRow({ testimonials, rowKey }: TestimonialRowProps) {
  return (
    <div className='animation-container flex w-full animate-fade-up flex-col text-white opacity-0 will-change-[opacity,transform] [animation-delay:400ms]'>
      <Marquee className='flex w-full [--duration:40s] [--gap:16px]' pauseOnHover={true}>
        {testimonials.map((card, index) => (
          <motion.div
            key={`${rowKey}-${index}`}
            className='flex min-w-[280px] max-w-[340px] cursor-pointer flex-col gap-2 rounded-xl border border-[#333] bg-[#121212] p-2 sm:min-w-[320px] sm:max-w-[380px] sm:p-3'
            whileHover={{ scale: 1.02, boxShadow: '0 2px 4px 0 rgba(0, 0, 0, 0.08)' }}
            onClick={() =>
              card.tweetUrl && window.open(card.tweetUrl, '_blank', 'noopener,noreferrer')
            }
          >
            <div className='flex flex-col gap-1'>
              <p className='text-sm text-white sm:text-base'>{card.text}</p>
            </div>
            <div className='mt-auto flex items-center justify-between'>
              <div className='flex items-center gap-1.5 sm:gap-2'>
                {card.profileImage && (
                  <img
                    src={card.profileImage}
                    alt={`${card.username} profile`}
                    className='h-6 w-6 rounded-full border border-[#333] object-cover sm:h-8 sm:w-8'
                  />
                )}
                <div className='flex items-center'>
                  <span className='text-white/80 text-xs sm:text-sm'>@</span>
                  <p className='text-white/80 text-xs sm:text-sm'>
                    {card.username.replace('@', '')}
                  </p>
                </div>
              </div>
              <div className='flex items-center'>
                <p className='text-[10px] text-white/60 sm:text-xs'>{card.viewCount} views</p>
              </div>
            </div>
          </motion.div>
        ))}
      </Marquee>
    </div>
  )
}

function Testimonials() {
  const { isMobile, mounted } = useIsMobile()

  if (!mounted) {
    return (
      <section className='relative flex w-full flex-col overflow-hidden py-10 sm:py-12 md:py-16' />
    )
  }

  return (
    <section className='animation-container relative flex w-full flex-col overflow-hidden py-10 will-change-[opacity,transform] sm:py-12 md:py-16'>
      <div className='flex flex-col items-center gap-3 px-4 pb-6 sm:gap-5 sm:pb-8 md:pb-10'>
        {isMobile ? (
          <p className='text-center text-[42px] text-white tracking-normal md:text-5xl'>Loved by</p>
        ) : (
          <motion.p
            className='text-center text-5xl text-white tracking-normal'
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
          >
            Loved by
          </motion.p>
        )}
      </div>

      <div className='mt-0 flex flex-col gap-4'>
        {/* First Row of X Posts */}
        <TestimonialRow testimonials={firstRowTestimonials} rowKey='first-row' />

        {/* Second Row of X Posts */}
        <div style={{ animationDelay: '200ms' }}>
          <TestimonialRow testimonials={secondRowTestimonials} rowKey='second-row' />
        </div>
      </div>
    </section>
  )
}

export default Testimonials
