'use client'

import Link from 'next/link'
import { useBrandedButtonClass } from '@/hooks/use-branded-button-class'

interface BrandedLinkProps {
  href: string
  children: React.ReactNode
  className?: string
  target?: string
  rel?: string
}

export function BrandedLink({ href, children, className = '', target, rel }: BrandedLinkProps) {
  const buttonClass = useBrandedButtonClass()

  return (
    <Link
      href={href}
      target={target}
      rel={rel}
      className={`${buttonClass} group inline-flex items-center justify-center gap-2 rounded-[10px] py-[6px] pr-[10px] pl-[12px] text-[15px] text-white transition-all ${className}`}
    >
      {children}
    </Link>
  )
}
