import { Plus, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface EvalMetric {
  id: string
  name: string
  description: string
  range: {
    min: number
    max: number
  }
}

interface EvalInputProps {
  blockId: string
  subBlockId: string
}

// Default values
const DEFAULT_METRIC: EvalMetric = {
  id: crypto.randomUUID(),
  name: '',
  description: '',
  range: { min: 0, max: 1 },
}

export function EvalInput({ blockId, subBlockId }: EvalInputProps) {
  // State hooks
  const [value, setValue] = useSubBlockValue<EvalMetric[]>(blockId, subBlockId)
  const metrics = value || [DEFAULT_METRIC]

  // Metric operations
  const addMetric = () => {
    const newMetric: EvalMetric = {
      ...DEFAULT_METRIC,
      id: crypto.randomUUID(),
    }
    setValue([...metrics, newMetric])
  }

  const removeMetric = (id: string) => {
    if (metrics.length === 1) return
    setValue(metrics.filter((metric) => metric.id !== id))
  }

  // Update handlers
  const updateMetric = (id: string, field: keyof EvalMetric, value: any) => {
    setValue(metrics.map((metric) => (metric.id === id ? { ...metric, [field]: value } : metric)))
  }

  const updateRange = (id: string, field: 'min' | 'max', value: string) => {
    setValue(
      metrics.map((metric) =>
        metric.id === id
          ? {
              ...metric,
              range: { ...metric.range, [field]: value },
            }
          : metric
      )
    )
  }

  // Validation handlers
  const handleRangeBlur = (id: string, field: 'min' | 'max', value: string) => {
    const sanitizedValue = value.replace(/[^\d.-]/g, '')
    const numValue = parseFloat(sanitizedValue)

    setValue(
      metrics.map((metric) =>
        metric.id === id
          ? {
              ...metric,
              range: {
                ...metric.range,
                [field]: !isNaN(numValue) ? numValue : 0,
              },
            }
          : metric
      )
    )
  }

  // Metric header
  const renderMetricHeader = (metric: EvalMetric, index: number) => (
    <div className="flex h-10 items-center justify-between bg-card px-3 rounded-t-lg border-b">
      <span className="text-sm font-medium">Metric {index + 1}</span>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={addMetric} className="h-8 w-8">
              <Plus className="h-4 w-4" />
              <span className="sr-only">Add Metric</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add Metric</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeMetric(metric.id)}
              disabled={metrics.length === 1}
              className="h-8 w-8 text-destructive hover:text-destructive"
            >
              <Trash className="h-4 w-4" />
              <span className="sr-only">Delete Metric</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete Metric</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )

  // Main render
  return (
    <div className="space-y-2">
      {metrics.map((metric, index) => (
        <div
          key={metric.id}
          data-metric-id={metric.id}
          className="overflow-visible rounded-lg border bg-background group relative"
        >
          {renderMetricHeader(metric, index)}

          <div className="px-3 pt-2 pb-3 space-y-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                name="name"
                value={metric.name}
                onChange={(e) => updateMetric(metric.id, 'name', e.target.value)}
                placeholder="Accuracy"
                className="placeholder:text-muted-foreground/50"
              />
            </div>

            <div className="space-y-1">
              <Label>Description</Label>
              <Input
                value={metric.description}
                onChange={(e) => updateMetric(metric.id, 'description', e.target.value)}
                placeholder="How accurate is the response?"
                className="placeholder:text-muted-foreground/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Min Value</Label>
                <Input
                  type="text"
                  value={metric.range.min}
                  onChange={(e) => updateRange(metric.id, 'min', e.target.value)}
                  onBlur={(e) => handleRangeBlur(metric.id, 'min', e.target.value)}
                  className="placeholder:text-muted-foreground/50"
                />
              </div>
              <div className="space-y-1">
                <Label>Max Value</Label>
                <Input
                  type="text"
                  value={metric.range.max}
                  onChange={(e) => updateRange(metric.id, 'max', e.target.value)}
                  onBlur={(e) => handleRangeBlur(metric.id, 'max', e.target.value)}
                  className="placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
