export function FAQ({ items }: { items: { q: string; a: string }[] }) {
  if (!items || items.length === 0) return null
  const occurrences = new Map<string, number>()
  return (
    <section className='mt-12' itemScope itemType='https://schema.org/FAQPage'>
      <h2 className='mb-4 font-medium text-[24px] text-[var(--text-primary)]'>FAQ</h2>
      <div className='space-y-6'>
        {items.map((it) => {
          const signature = `${it.q}\u0000${it.a}`
          const occurrence = occurrences.get(signature) ?? 0
          occurrences.set(signature, occurrence + 1)
          return (
            <div
              key={`${signature}\u0000${occurrence}`}
              itemScope
              itemType='https://schema.org/Question'
              itemProp='mainEntity'
            >
              <h3
                className='mb-2 font-medium text-[20px] text-[var(--text-primary)]'
                itemProp='name'
              >
                {it.q}
              </h3>
              <div itemScope itemType='https://schema.org/Answer' itemProp='acceptedAnswer'>
                <p
                  className='text-[19px] text-[var(--text-subtle)] leading-relaxed'
                  itemProp='text'
                >
                  {it.a}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
