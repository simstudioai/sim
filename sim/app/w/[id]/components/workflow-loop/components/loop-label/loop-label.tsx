import { NodeProps } from 'reactflow'
import { Badge } from '@/components/ui/badge'

export function LoopLabel({ data }: NodeProps) {
  return (
    <Badge
      variant="outline"
      className="bg-background border-border text-foreground font-medium px-2 py-0.5 text-sm 
      hover:bg-accent/50 transition-colors duration-150"
    >
      {data.label}
    </Badge>
  )
}
