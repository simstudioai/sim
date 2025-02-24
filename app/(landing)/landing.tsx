'use client'

import Image from 'next/image'
import HeroWorkflowProvider from './hero-workflow'
import WaitlistForm from './waitlist-form'

/**
 * Landing page component for Sim Studio
 * Displays the main marketing page with hero section, navigation, and waitlist form
 * @returns {JSX.Element} The rendered landing page
 */
export default function Landing() {
  return (
    <main className="bg-[#020817] relative overflow-x-hidden">
      {/* Fixed navigation bar with blur effect */}
      <nav className="fixed top-1 left-0 right-0 z-10 bg-[#020817]/80 backdrop-blur-sm px-4 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-xl font-medium text-white">sim studio</div>

          {/* Update navigation section */}
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/simstudioai/sim"
              className="text-muted-foreground hover:text-muted-foreground/80 transition-colors text-sm font-normal"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>

      {/* Hero section with video background */}
      <section className="min-h-[100dvh] pt-[134px] md:pt-36 text-white relative">
        {/* Full-screen video background */}
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

        {/* Gradient overlay for better text visibility */}
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#020817]/80 to-[#020817]/40" />

        {/* Main content container */}
        <div className="max-w-6xl mx-auto text-center space-y-6 relative z-10 px-4">
          {/* Animated heading with staggered fade-up effect */}
          <h1 className="text-5xl md:text-7xl font-medium animate-fade-up [animation-delay:200ms] opacity-0 translate-y-[-10px]">
            build / deploy
            <br />
            agent workflows
          </h1>

          {/* Subheading with delayed animation */}
          <p className="text-[15px] md:text-xl text-muted-foreground max-w-3xl mx-auto animate-fade-up [animation-delay:400ms] opacity-0 translate-y-[-10px]">
            Launch agentic workflows with an open source, <br />
            user-friendly environment for devs and agents
          </p>

          {/* Waitlist form component with delayed animation */}
          <div className="animate-fade-up [animation-delay:600ms] opacity-0 translate-y-[-10px]">
            <WaitlistForm />
          </div>

          {/* Interactive workflow demo section */}
          <div className="mt-16 -mx-4">
            <HeroWorkflowProvider />
          </div>
        </div>
      </section>
    </main>
  )
}
