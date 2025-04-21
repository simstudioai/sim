import NavWrapper from './components/nav-wrapper'
import Blogs from './components/sections/blogs'
import Features from './components/sections/features'
import Footer from './components/sections/footer'
import Hero from './components/sections/hero'
import Integrations from './components/sections/integrations'
import Testimonials from './components/sections/testimonials'

export default function Landing() {
  return (
    <main className="bg-[#0C0C0C] relative min-h-screen font-geist-sans">
      <NavWrapper />

      <Hero />
      <Testimonials />
      {/* <Features /> */}
      <Integrations />
      {/* <Blogs /> */}

      {/* Footer */}
      <Footer />
    </main>
  )
}
