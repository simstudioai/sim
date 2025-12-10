'use client'

import { type ComponentPropsWithoutRef, useState } from 'react'
import { Check, Link } from 'lucide-react'
import { cn } from '@/lib/utils'

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

interface HeadingProps extends ComponentPropsWithoutRef<'h1'> {
  as?: HeadingTag
}

export function Heading({ as, className, ...props }: HeadingProps) {
  const [copied, setCopied] = useState(false)
  const As = as ?? 'h1'

  if (!props.id) {
    return <As className={className} {...props} />
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()

    const url = `${window.location.origin}${window.location.pathname}#${props.id}`

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)

      // Update URL hash without scrolling
      window.history.pushState(null, '', `#${props.id}`)

      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: just navigate to the anchor
      window.location.hash = props.id as string
    }
  }

  return (
    <As className={cn('group flex scroll-m-28 flex-row items-center gap-2', className)} {...props}>
      <a data-card='' href={`#${props.id}`} className='peer' onClick={handleClick}>
        {props.children}
      </a>
      {copied ? (
        <Check
          aria-hidden
          className='size-3.5 shrink-0 text-green-500 opacity-100 transition-opacity'
        />
      ) : (
        <Link
          aria-hidden
          className='size-3.5 shrink-0 text-fd-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 peer-hover:opacity-100'
        />
      )}
    </As>
  )
}
