export function StudioHero() {
  return (
    <section className='relative overflow-hidden border-b border-[#2A2A2A] pb-10 pt-14'>
      <div
        className='pointer-events-none absolute inset-0 opacity-50'
        aria-hidden='true'
        style={{
          backgroundImage:
            'radial-gradient(circle at 2px 2px, rgba(255, 255, 255, 0.04) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className='relative z-10 mx-auto max-w-5xl'>
        <div className='flex flex-col items-start'>
          <div className='mb-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#999]'>
            <span className='inline-block h-2 w-2 flex-shrink-0 bg-[#2ABBF8]' aria-hidden='true' />
            Sim / Insights
          </div>
          <h1 className='mb-3 max-w-3xl text-balance font-[430] text-[40px] leading-[1.1] tracking-[-0.02em] text-[#ECECEC] sm:text-[56px] md:text-[64px]'>
            Building the future of <span className='text-[#666]'>autonomous workflows.</span>
          </h1>
          <p className='max-w-2xl text-[18px] leading-relaxed tracking-[0.02em] text-[#999]'>
            Deep dives, product updates, and technical tutorials from the team building Sim.
          </p>
        </div>
      </div>
    </section>
  )
}
