import { WordmarkMorph } from '@/components/ui/wordmark-morph'

interface FooterWordmarkLoopProps {
  /** Layout only: margins and alignment. */
  className?: string
}

/** The footer's closing brand animation at its responsive display size. */
export function FooterWordmarkLoop({ className }: FooterWordmarkLoopProps) {
  return <WordmarkMorph size='lg' className={className} />
}
