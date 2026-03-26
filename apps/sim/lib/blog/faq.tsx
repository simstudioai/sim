export function FAQ({ items }: { items: { q: string; a: string }[] }) {
  if (!items || items.length === 0) return null
  return (
    <section className='mt-12'>
      <h2 className='mb-4 font-medium text-[24px] text-[var(--landing-text)]'>FAQ</h2>
      <div className='space-y-6'>
        {items.map((it, i) => (
          <div key={i}>
            <h3 className='mb-2 font-medium text-[20px] text-[var(--landing-text)]'>{it.q}</h3>
            <p className='text-[19px] text-[var(--text-subtle)] leading-relaxed'>{it.a}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
