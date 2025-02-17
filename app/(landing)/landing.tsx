import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import HeroWorkflowProvider from './hero-workflow'

export default function Landing() {
  return (
    <main className="bg-[#020817] relative overflow-x-hidden">
      <nav className="fixed top-1 left-0 right-0 z-10 bg-[#020817]/80 backdrop-blur-sm px-4 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-xl font-medium text-white">sim studio</div>

          {/* Update navigation section */}
          <div className="flex items-center gap-6">
            <a
              href="https://github.com"
              className="text-muted-foreground hover:text-muted-foreground/80 transition-colors text-sm font-normal"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>

      <section className="min-h-[100dvh] pt-28 text-white relative">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: "url('/Hero.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#020817]/80 to-[#020817]/40" />
        <div className="max-w-6xl mx-auto text-center space-y-4 relative z-10 px-4">
          <h1 className="text-4xl md:text-7xl font-medium tracking-tight">
            dev first agent
            <br />
            workflow builder
          </h1>

          <p className="text-base md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Build and deploy your agentic workflows with an open source,
            <br className="hidden md:block" />
            user-friendly environment for devs and agents
          </p>

          <div className="flex gap-3 justify-center max-w-lg mx-auto mt-8">
            <Input
              type="email"
              placeholder="you@example.com"
              className="flex-1 text-lg bg-[#020817] border-white/20 focus:border-white/30 focus:ring-white/30 rounded-md h-12"
            />
            <Button className="bg-white text-black hover:bg-gray-100 rounded-md px-8 h-12">
              Join waitlist
            </Button>
          </div>

          <div className="mt-10 -mx-4">
            <HeroWorkflowProvider />
          </div>
        </div>
      </section>
    </main>
  )
}
