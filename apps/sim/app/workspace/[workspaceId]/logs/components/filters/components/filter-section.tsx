import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export default function FilterSection({
  title,
  defaultOpen = false,
  content,
}: {
  title: string
  defaultOpen?: boolean
  content?: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='mb-3'>
      <CollapsibleTrigger asChild>
        <Button
          variant='ghost'
          className='flex w-full justify-between rounded-md px-2 font-medium text-sm hover:bg-accent'
        >
          <span>{title}</span>
          <ChevronDown
            className={`mr-[5px] h-4 w-4 text-muted-foreground transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className='pt-2'>
        {content || (
          <div className='text-muted-foreground text-sm'>
            Filter options for {title} will go here
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
