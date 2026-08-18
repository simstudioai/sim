'use client'

import { useRef } from 'react'
import { Button, cn, useCopyToClipboard } from '@sim/emcn'
import { Check, Duplicate } from '@sim/emcn/icons'
import { CodeBlock as FumadocsCodeBlock } from 'fumadocs-ui/components/codeblock'

/** Copy control for a code block — emcn's canonical icon button for a lone glyph affordance. */
function CopyButton({ getCode }: { getCode: () => string }) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button
      type='button'
      variant='quiet'
      size='icon'
      aria-label={copied ? 'Copied Text' : 'Copy Text'}
      onClick={() => copy(getCode())}
      /**
       * Tailwind v4's preflight sets `button { cursor: default }`. `apps/sim` is on v3, where
       * buttons keep the UA pointer, so `buttonVariants` never had to declare one — without
       * this the same control feels inert here and live there.
       */
      className='cursor-pointer'
    >
      {copied ? (
        <Check className='size-[14px] text-[var(--brand-accent)]' />
      ) : (
        <Duplicate className='size-[14px]' />
      )}
    </Button>
  )
}

/**
 * Docs code block for prose fences, wired into the MDX `pre` mapping.
 *
 * The shell — radius, hairline, fill — is not set here. Request and response samples in the
 * API reference come from fumadocs-openapi's own renderer, so the two share chrome through a
 * `figure.shiki` rule in `global.css` instead; see the note there. What stays here is the
 * part only this path has: the copy control, and the `my-4` prose rhythm that API samples,
 * which sit flush in their panel, must not inherit.
 */
export function CodeBlock({ title, ...props }: React.ComponentProps<typeof FumadocsCodeBlock>) {
  const figureRef = useRef<HTMLElement>(null)

  /**
   * Reads the block's text the way fumadocs does: from a clone, with `.nd-copy-ignore` nodes
   * replaced by newlines. Those nodes carry rendered gutter and diff markers, so copying the
   * live `textContent` would paste line numbers along with the code.
   */
  function getCode() {
    const pre = figureRef.current?.getElementsByTagName('pre').item(0)
    if (!pre) return ''
    const clone = pre.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.nd-copy-ignore').forEach((node) => node.replaceWith('\n'))
    return clone.textContent ?? ''
  }

  return (
    <FumadocsCodeBlock
      ref={figureRef}
      title={title}
      {...props}
      className={cn('my-4', props.className)}
      allowCopy={false}
      /**
       * fumadocs' own `className` is discarded rather than merged — its untitled-block variant
       * carries a `backdrop-blur-lg` that goes milky over an opaque fill.
       */
      Actions={() => (
        <div className={cn('flex items-center', title ? '-me-1' : 'absolute top-2 right-2 z-[1]')}>
          <CopyButton getCode={getCode} />
        </div>
      )}
    />
  )
}
