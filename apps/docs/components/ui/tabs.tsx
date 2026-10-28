import { cn } from '@sim/emcn'
import {
  Tab as FumadocsTab,
  type TabProps as FumadocsTabProps,
  Tabs as FumadocsTabs,
  type TabsProps as FumadocsTabsProps,
} from 'fumadocs-ui/components/tabs'

interface TabsProps extends FumadocsTabsProps {}

interface TabProps extends FumadocsTabProps {}

/** Keeps the dependency's selection and keyboard behavior with platform tab tokens. */
export function Tabs({ className, ...props }: TabsProps) {
  return (
    <FumadocsTabs
      {...props}
      className={cn(
        'min-w-0 scroll-mt-[calc(var(--fd-docs-row-3,0px)+1rem)] border-[var(--border)] [&>[role=tablist]>button]:font-normal! max-sm:[&>[role=tablist]>button]:min-h-11 [&>[role=tablist]]:min-w-0 [&>[role=tablist]]:[scrollbar-width:thin] max-sm:[&>[role=tablist]]:min-h-14',
        className
      )}
    />
  )
}

/** Only a panel containing a single code fence can omit its content inset. */
export function Tab({ className, ...props }: TabProps) {
  return (
    <FumadocsTab
      {...props}
      className={cn(
        'min-w-0 p-4! [overflow-wrap:anywhere] has-[>figure:only-child]:p-0!',
        className
      )}
    />
  )
}
