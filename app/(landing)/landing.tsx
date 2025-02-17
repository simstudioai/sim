import Image from 'next/image'
import HeroWorkflowProvider from './hero-workflow'
import WaitlistForm from './waitlist-form'

export default function Landing() {
  return (
    <main className="bg-[#020817] relative overflow-x-hidden">
      <nav className="fixed top-1 left-0 right-0 z-10 bg-[#020817]/80 backdrop-blur-sm px-4 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-xl font-medium text-white">sim studio</div>

          {/* Update navigation section */}
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/simstudioai"
              className="text-muted-foreground hover:text-muted-foreground/80 transition-colors text-sm font-normal"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>

      <section className="min-h-[100dvh] pt-[134px] md:pt-36 text-white relative">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero.png"
            alt="Hero background"
            fill
            priority
            loading="eager"
            fetchPriority="high"
            className="object-cover"
            quality={100}
          />
        </div>
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#020817]/80 to-[#020817]/40" />
        <div className="max-w-6xl mx-auto text-center space-y-6 relative z-10 px-4">
          <h1 className="text-5xl md:text-7xl font-medium">
            dev first agent
            <br />
            workflow builder
          </h1>

          <p className="text-[15px] md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Build and deploy your agentic workflows with an open source,{' '}
            <br className="hidden md:block" />
            user-friendly environment for devs and agents
          </p>

          <WaitlistForm />

          <div className="mt-16 -mx-4">
            <HeroWorkflowProvider />
          </div>
        </div>
      </section>
    </main>
  )
}
