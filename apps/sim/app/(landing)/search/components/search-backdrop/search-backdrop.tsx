/** A soft neutral radial glow behind the hero animation. */
export function SearchBackdrop() {
  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,color-mix(in_srgb,var(--text-secondary)_9%,transparent)_0%,color-mix(in_srgb,var(--text-secondary)_4%,transparent)_35%,transparent_70%)] dark:opacity-60' />
      <div className='absolute inset-0 bg-[linear-gradient(to_bottom,var(--bg),transparent_22%,transparent_72%,var(--bg))]' />
    </div>
  )
}
