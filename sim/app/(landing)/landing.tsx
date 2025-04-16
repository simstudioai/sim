import GitHubStars from './components/github-stars'
import NavClient from './components/nav-client'
import Features from './components/sections/features'
import Hero from './components/sections/hero'
import Integrations from './components/sections/integrations'

export default function Landing() {
  return (
    <main className="bg-[#0C0C0C] relative overflow-x-hidden font-geist-sans">
      <NavClient>
        <GitHubStars />
      </NavClient>

      <Hero/>
      <Features/>
      <Integrations/>

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
