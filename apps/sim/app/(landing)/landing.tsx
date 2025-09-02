import Background from '@/app/(landing)/components/background'
import Hero from '@/app/(landing)/components/hero/hero'
import Nav from '@/app/(landing)/components/nav/nav'
import Templates from '@/app/(landing)/components/templates/templates'

export default function Landing() {
  return (
    <main className='relative'>
      <Background>
        <Nav />
        <Hero />
        <Templates />
      </Background>

      {/* Templates Section */}
      {/* TODO: Add Templates component */}

      {/* Enterprise Section */}
      {/* TODO: Add Enterprise component */}

      {/* Integrations Section */}
      {/* TODO: Add Integrations component */}

      {/* Social Section */}
      {/* TODO: Add Social component */}

      {/* Pricing Section */}
      {/* TODO: Add Pricing component */}

      {/* Footer Section */}
      {/* TODO: Add Footer component */}
    </main>
  )
}
