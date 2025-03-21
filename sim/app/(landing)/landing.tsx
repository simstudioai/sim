import GitHubStars from './github-stars'
import HeroWorkflowProvider from './hero-workflow'
import NavClient from './nav-client'
import WaitlistForm from './waitlist-form'

export default function Landing() {
  return (
    <main className="bg-[#020817] relative overflow-x-hidden">
      <NavClient>
        <GitHubStars />
      </NavClient>

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
