import { ChipTextarea } from '@sim/emcn'

export default function OrganizationHomeLoading() {
  return (
    <div className='flex h-full flex-col px-6 py-12'>
      <div className='mx-auto flex w-full max-w-chat flex-col gap-6'>
        <h1 className='font-season text-2xl text-[var(--text-primary)]'>
          What would you like to find?
        </h1>
        <ChipTextarea
          disabled
          rows={3}
          placeholder='Ask about your sources…'
          aria-label='Ask about your sources'
        />
      </div>
    </div>
  )
}
