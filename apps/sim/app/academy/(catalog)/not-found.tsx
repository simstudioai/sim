import Link from 'next/link'

export default function AcademyNotFound() {
  return (
    <main className='flex flex-1 flex-col items-center justify-center px-6 py-32 text-center'>
      <p className='mb-2 font-mono text-[#555] text-[13px] uppercase tracking-widest'>404</p>
      <h1 className='mb-3 font-[430] text-[#ECECEC] text-[28px] leading-[120%]'>Page not found</h1>
      <p className='mb-8 text-[#666] text-[15px]'>
        That course or lesson doesn't exist in the Academy.
      </p>
      <Link
        href='/academy'
        className='rounded-[5px] bg-[#ECECEC] px-5 py-2.5 font-[430] text-[#1C1C1C] text-[14px] transition-colors hover:bg-white'
      >
        Back to Academy
      </Link>
    </main>
  )
}
