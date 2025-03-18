'use client'

import { Star } from 'lucide-react'
import { GithubIcon } from '@/components/icons'
import HeroWorkflowProvider from './hero-workflow'
import { useWindowSize } from './use-window-size'
import WaitlistForm from './waitlist-form'

const XIcon = () => (
  <svg
    data-testid="geist-icon"
    height="18"
    strokeLinejoin="round"
    viewBox="0 0 16 16"
    width="18"
    className="w-4.5 h-4.5"
    style={{ color: 'currentcolor' }}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M0.5 0.5H5.75L9.48421 5.71053L14 0.5H16L10.3895 6.97368L16.5 15.5H11.25L7.51579 10.2895L3 15.5H1L6.61053 9.02632L0.5 0.5ZM12.0204 14L3.42043 2H4.97957L13.5796 14H12.0204Z"
      fill="currentColor"
    ></path>
  </svg>
)

const DiscordIcon = () => (
  <svg
    data-testid="geist-icon"
    height="18"
    strokeLinejoin="round"
    viewBox="0 0 16 16"
    width="18"
    className="w-4.5 h-4.5"
    style={{ color: 'currentcolor' }}
  >
    <path
      d="M13.5535 3.01557C12.5023 2.5343 11.3925 2.19287 10.2526 2C10.0966 2.27886 9.95547 2.56577 9.82976 2.85952C8.6155 2.67655 7.38067 2.67655 6.16641 2.85952C6.04063 2.5658 5.89949 2.27889 5.74357 2C4.60289 2.1945 3.4924 2.53674 2.44013 3.01809C0.351096 6.10885 -0.215207 9.12285 0.0679444 12.0941C1.29133 12.998 2.66066 13.6854 4.11639 14.1265C4.44417 13.6856 4.73422 13.2179 4.98346 12.7283C4.51007 12.5515 4.05317 12.3334 3.61804 12.0764C3.73256 11.9934 3.84456 11.9078 3.95279 11.8248C5.21891 12.4202 6.60083 12.7289 7.99997 12.7289C9.39912 12.7289 10.781 12.4202 12.0472 11.8248C12.1566 11.9141 12.2686 11.9997 12.3819 12.0764C11.9459 12.3338 11.4882 12.5524 11.014 12.7296C11.2629 13.2189 11.553 13.6862 11.881 14.1265C13.338 13.6872 14.7084 13.0001 15.932 12.0953C16.2642 8.64968 15.3644 5.66336 13.5535 3.01557ZM5.34212 10.2668C4.55307 10.2668 3.90119 9.55073 3.90119 8.66981C3.90119 7.78889 4.53042 7.06654 5.3396 7.06654C6.14879 7.06654 6.79563 7.78889 6.78179 8.66981C6.76795 9.55073 6.14627 10.2668 5.34212 10.2668ZM10.6578 10.2668C9.86752 10.2668 9.21815 9.55073 9.21815 8.66981C9.21815 7.78889 9.84738 7.06654 10.6578 7.06654C11.4683 7.06654 12.1101 7.78889 12.0962 8.66981C12.0824 9.55073 11.462 10.2668 10.6578 10.2668Z"
      fill="currentColor"
    ></path>
  </svg>
)

export default function Landing() {
  const { width } = useWindowSize()
  const isMobile = width !== undefined && width < 640

  return (
    <main className="bg-[#020817] relative overflow-x-hidden">
      <nav className="fixed top-1 left-0 right-0 z-10 backdrop-blur-sm px-4 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-xl text-white">sim studio</div>

          {/* Social media icons */}
          <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
            <a
              href="https://x.com/simstudioai"
              className="text-white/80 hover:text-white/100 p-2 rounded-md group hover:scale-[1.04] transition-colors transition-transform duration-200"
              aria-label="Twitter"
              target="_blank"
              rel="noopener noreferrer"
            >
              <XIcon />
            </a>
            <a
              href="https://discord.gg/pQKwMTvNrg"
              className="text-white/80 hover:text-white/100 p-2 rounded-md group hover:scale-[1.04] transition-colors transition-transform duration-200"
              aria-label="Discord"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DiscordIcon />
            </a>
            <a
              href="https://github.com/simstudioai/sim"
              className="flex items-center gap-2 text-white/80 hover:text-white/100 p-2 rounded-md group hover:scale-[1.04] transition-colors transition-transform duration-200"
              aria-label="GitHub"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon className="w-[20px] h-[20px]" />
              <div className="flex items-center justify-center gap-1">
                <span className="text-sm font-medium py-[2px]">29</span>
                <Star className="w-3.5 h-3.5 fill-white/80 stroke-none group-hover:fill-white" />
              </div>
            </a>
          </div>
        </div>
      </nav>

      <section className="min-h-[100dvh] pt-[134px] md:pt-36 text-white relative">
        <div className="absolute inset-0 z-0">
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="h-full w-full object-cover"
            poster="/hero.png"
          >
            <source src="/hero.webm" type="video/webm" media="all" />
          </video>
        </div>
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#020817]/80 to-[#020817]/40" />
        <div className="max-w-6xl mx-auto text-center space-y-6 relative z-10 px-4">
          <h1 className="text-5xl md:text-7xl font-medium animate-fade-up [animation-delay:200ms] opacity-0 translate-y-[-10px]">
            build / deploy
            <br />
            agent workflows
          </h1>

          <p className="text-[15px] md:text-xl text-muted-foreground max-w-3xl mx-auto animate-fade-up [animation-delay:400ms] opacity-0 translate-y-[-10px]">
            Launch agentic workflows with an open source, <br />
            user-friendly environment for devs and agents
          </p>

          <div className="animate-fade-up [animation-delay:600ms] opacity-0 translate-y-[-10px]">
            <WaitlistForm />
          </div>

          <div className="mt-16 -mx-4">
            <HeroWorkflowProvider />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6 text-white/60">
        <div className="max-w-6xl mx-auto flex justify-center items-center px-4">
          <nav className="flex space-x-6 text-sm">
            <a href="/privacy" className="hover:text-white transition-colors duration-200">
              Privacy
            </a>
            <a href="/terms" className="hover:text-white transition-colors duration-200">
              Terms
            </a>
          </nav>
        </div>
      </footer>
    </main>
  )
}
