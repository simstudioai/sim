'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Atom,
  BotMessageSquare,
  Brain,
  BrainCircuit,
  ChartBar,
  Code,
  Database,
  HelpCircle,
  LineChart,
  MailIcon,
  NotebookPen,
  Store,
  TimerIcon,
  X,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface MarketplaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Form schema for validation
const marketplaceFormSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(50, 'Name cannot exceed 50 characters'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description cannot exceed 500 characters'),
  category: z.string().min(1, 'Please select a category'),
  authorName: z
    .string()
    .min(2, 'Author name must be at least 2 characters')
    .max(50, 'Author name cannot exceed 50 characters'),
})

type MarketplaceFormValues = z.infer<typeof marketplaceFormSchema>

// Categories for the dropdown with icons
const CATEGORIES = [
  //   {
  //     value: 'project_management',
  //     label: 'Project Management',
  //     icon: <ChartBar className="h-4 w-4 mr-2" />,
  //   },
  { value: 'data', label: 'Data Analysis', icon: <Database className="h-4 w-4 mr-2" /> },
  { value: 'marketing', label: 'Marketing', icon: <MailIcon className="h-4 w-4 mr-2" /> },
  { value: 'sales', label: 'Sales', icon: <Store className="h-4 w-4 mr-2" /> },
  //   { value: 'productivity', label: 'Productivity', icon: <TimerIcon className="h-4 w-4 mr-2" /> },
  //   { value: 'content', label: 'Content Creation', icon: <NotebookPen className="h-4 w-4 mr-2" /> },
  {
    value: 'customer_service',
    label: 'Customer Service',
    icon: <BotMessageSquare className="h-4 w-4 mr-2" />,
  },
  { value: 'research', label: 'Research', icon: <Atom className="h-4 w-4 mr-2" /> },
  { value: 'finance', label: 'Finance', icon: <LineChart className="h-4 w-4 mr-2" /> },
  { value: 'programming', label: 'Programming', icon: <Code className="h-4 w-4 mr-2" /> },
  { value: 'other', label: 'Other', icon: <Brain className="h-4 w-4 mr-2" /> },
]

// Tooltip texts
const TOOLTIPS = {
  category: 'Categorizing your workflow helps users find it more easily.',
  authorName: 'The name you want to publish under (defaults to your account name if left empty).',
}

export function MarketplaceModal({ open, onOpenChange }: MarketplaceModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { addNotification } = useNotificationStore()
  const { activeWorkflowId, workflows } = useWorkflowRegistry()

  // Initialize form with react-hook-form
  const form = useForm<MarketplaceFormValues>({
    resolver: zodResolver(marketplaceFormSchema),
    defaultValues: {
      name: '',
      description: '',
      category: 'marketing',
      authorName: '',
    },
  })

  // Update form values when the active workflow changes or modal opens
  useEffect(() => {
    if (open && activeWorkflowId && workflows[activeWorkflowId]) {
      const workflow = workflows[activeWorkflowId]
      form.setValue('name', workflow.name)
      form.setValue('description', workflow.description || '')
    }
  }, [open, activeWorkflowId, workflows, form])

  // Listen for the custom event to open the marketplace modal
  useEffect(() => {
    const handleOpenMarketplace = () => {
      onOpenChange(true)
    }

    // Add event listener
    window.addEventListener('open-marketplace', handleOpenMarketplace as EventListener)

    // Clean up
    return () => {
      window.removeEventListener('open-marketplace', handleOpenMarketplace as EventListener)
    }
  }, [onOpenChange])

  const onSubmit = async (data: MarketplaceFormValues) => {
    if (!activeWorkflowId) {
      addNotification('error', 'No active workflow to publish', null)
      return
    }

    try {
      setIsSubmitting(true)

      const response = await fetch('/api/marketplace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: activeWorkflowId,
          name: data.name,
          description: data.description,
          category: data.category,
          authorName: data.authorName,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to publish workflow')
      }

      const result = await response.json()

      addNotification(
        'console',
        'Workflow successfully published to marketplace',
        activeWorkflowId,
        {
          isPersistent: true,
          sections: [
            {
              label: 'Marketplace entry',
              content: result.data.name,
            },
          ],
        }
      )

      // Close the modal after successful submission
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error publishing workflow:', error)
      addNotification('error', `Failed to publish workflow: ${error.message}`, activeWorkflowId)
    } finally {
      setIsSubmitting(false)
    }
  }

  const LabelWithTooltip = ({ name, tooltip }: { name: string; tooltip: string }) => (
    <div className="flex items-center gap-1.5">
      <FormLabel>{name}</FormLabel>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px] p-3">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] flex flex-col p-0 gap-0" hideCloseButton>
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">Publish to Marketplace</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="pt-4 px-6 pb-6 overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workflow Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter workflow name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe what your workflow does and how it can help others"
                        className="min-h-24"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <LabelWithTooltip name="Category" tooltip={TOOLTIPS.category} />
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((category) => (
                          <SelectItem
                            key={category.value}
                            value={category.value}
                            className="flex items-center"
                          >
                            <div className="flex items-center">
                              {category.icon}
                              {category.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="authorName"
                render={({ field }) => (
                  <FormItem>
                    <LabelWithTooltip name="Author Name" tooltip={TOOLTIPS.authorName} />
                    <FormControl>
                      <Input placeholder="Enter author name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className={cn(
                    // Base styles
                    'gap-2 font-medium',
                    // Brand color with hover states
                    'bg-[#7F2FFF] hover:bg-[#7028E6]',
                    // Hover effect with brand color
                    'shadow-[0_0_0_0_#7F2FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    // Text color and transitions
                    'text-white transition-all duration-200',
                    // Running state animation
                    isSubmitting &&
                      'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
                    // Disabled state
                    'disabled:opacity-50 disabled:hover:bg-[#7F2FFF] disabled:hover:shadow-none'
                  )}
                >
                  {isSubmitting ? 'Publishing...' : 'Publish Workflow'}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
