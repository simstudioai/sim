import Image from 'next/image'
import Link from 'next/link'

export default function Logo() {
  return (
    <Link href='/' aria-label='Sim home'>
      <Image
        src='/logo/b&w/text/b&w.svg'
        alt='Sim - Workflows for LLMs'
        width={49.78314}
        height={24.276}
        priority
        quality={90}
      />
    </Link>
  )
}
