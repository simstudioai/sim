export function FAQ({ items }: { items: { q: string; a: string }[] }) {
  if (!items || items.length === 0) return null
  return (
    <section className='mt-12'>
      <h2 className='mb-4 font-medium text-[#ECECEC] text-[24px]'>FAQ</h2>
      <div className='space-y-6'>
        {items.map((it, i) => (
          <div key={i}>
            <h3 className='mb-2 font-medium text-[#ECECEC] text-[20px]'>{it.q}</h3>
            <p className='text-[#999] text-[19px] leading-relaxed'>{it.a}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
