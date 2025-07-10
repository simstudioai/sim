import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface PersonaOverviewProps {
  id: string
  name: string
  description: string
  workflowCount: number
  photo?: string
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function PersonaOverview({
  id,
  name,
  description,
  workflowCount,
  photo,
}: PersonaOverviewProps) {
  const [isCopied, setIsCopied] = useState(false)
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      // ignore
    }
  }

  const href = `/workspace/${workspaceId}/persona/${id}`

  return (
    <Link href={href} prefetch={true}>
      <div className='group flex cursor-pointer flex-col gap-3 rounded-md border bg-background p-4 transition-colors hover:bg-accent/50'>
        <div className='flex items-center gap-2'>
          <Avatar className='h-7 w-7 flex-shrink-0'>
            {photo ? (
              <AvatarImage src={photo} alt={name} />
            ) : (
              <AvatarFallback>{getInitials(name)}</AvatarFallback>
            )}
          </Avatar>
          <h3 className='truncate font-medium text-sm leading-tight'>{name}</h3>
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2 text-muted-foreground text-xs'>
            <span>
              {workflowCount} {workflowCount === 1 ? 'workflow' : 'workflows'}
            </span>
            <span>•</span>
            <div className='flex items-center gap-2'>
              <span className='truncate font-mono'>{id.slice(0, 8)}</span>
              <button
                onClick={handleCopy}
                className='flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              >
                {isCopied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
              </button>
            </div>
          </div>
          <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
            {description}
          </p>
        </div>
      </div>
    </Link>
  )
}
