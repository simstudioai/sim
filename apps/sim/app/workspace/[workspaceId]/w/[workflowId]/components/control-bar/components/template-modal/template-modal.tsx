'use client'

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Calculator,
  Cloud,
  Code,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Edit,
  FileText,
  Folder,
  Globe,
  HeadphonesIcon,
  Layers,
  Lightbulb,
  LineChart,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Phone,
  Play,
  Search,
  Server,
  Settings,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  User,
  Users,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/ui/color-picker'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { buildWorkflowStateForTemplate } from '@/lib/workflows/state-builder'
import { categories } from '@/app/workspace/[workspaceId]/templates/templates'

const logger = createLogger('TemplateModal')

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(500, 'Description must be less than 500 characters'),
  author: z
    .string()
    .min(1, 'Author is required')
    .max(100, 'Author must be less than 100 characters'),
  category: z.string().min(1, 'Category is required'),
  icon: z.string().min(1, 'Icon is required'),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color (e.g., #3972F6)'),
})

type TemplateFormData = z.infer<typeof templateSchema>

interface TemplateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
}

// Enhanced icon selection with category-relevant icons
const icons = [
  // Content & Documentation
  { value: 'FileText', label: 'File Text', component: FileText },
  { value: 'NotebookPen', label: 'Notebook', component: NotebookPen },
  { value: 'BookOpen', label: 'Book', component: BookOpen },
  { value: 'Edit', label: 'Edit', component: Edit },

  // Analytics & Charts
  { value: 'BarChart3', label: 'Bar Chart', component: BarChart3 },
  { value: 'LineChart', label: 'Line Chart', component: LineChart },
  { value: 'TrendingUp', label: 'Trending Up', component: TrendingUp },
  { value: 'Target', label: 'Target', component: Target },

  // Database & Storage
  { value: 'Database', label: 'Database', component: Database },
  { value: 'Server', label: 'Server', component: Server },
  { value: 'Cloud', label: 'Cloud', component: Cloud },
  { value: 'Folder', label: 'Folder', component: Folder },

  // Marketing & Communication
  { value: 'Megaphone', label: 'Megaphone', component: Megaphone },
  { value: 'Mail', label: 'Mail', component: Mail },
  { value: 'MessageSquare', label: 'Message', component: MessageSquare },
  { value: 'Phone', label: 'Phone', component: Phone },
  { value: 'Bell', label: 'Bell', component: Bell },

  // Sales & Finance
  { value: 'DollarSign', label: 'Dollar Sign', component: DollarSign },
  { value: 'CreditCard', label: 'Credit Card', component: CreditCard },
  { value: 'Calculator', label: 'Calculator', component: Calculator },
  { value: 'ShoppingCart', label: 'Shopping Cart', component: ShoppingCart },
  { value: 'Briefcase', label: 'Briefcase', component: Briefcase },

  // Support & Service
  { value: 'HeadphonesIcon', label: 'Headphones', component: HeadphonesIcon },
  { value: 'User', label: 'User', component: User },
  { value: 'Users', label: 'Users', component: Users },
  { value: 'Settings', label: 'Settings', component: Settings },
  { value: 'Wrench', label: 'Wrench', component: Wrench },

  // AI & Technology
  { value: 'Bot', label: 'Bot', component: Bot },
  { value: 'Brain', label: 'Brain', component: Brain },
  { value: 'Cpu', label: 'CPU', component: Cpu },
  { value: 'Code', label: 'Code', component: Code },
  { value: 'Zap', label: 'Zap', component: Zap },

  // Workflow & Process
  { value: 'Workflow', label: 'Workflow', component: Workflow },
  { value: 'Search', label: 'Search', component: Search },
  { value: 'Play', label: 'Play', component: Play },
  { value: 'Layers', label: 'Layers', component: Layers },

  // General
  { value: 'Lightbulb', label: 'Lightbulb', component: Lightbulb },
  { value: 'Star', label: 'Star', component: Star },
  { value: 'Globe', label: 'Globe', component: Globe },
  { value: 'Award', label: 'Award', component: Award },
]

export function TemplateModal({ open, onOpenChange, workflowId }: TemplateModalProps) {
  const { data: session } = useSession()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false)

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      description: '',
      author: session?.user?.name || session?.user?.email || '',
      category: '',
      icon: 'FileText',
      color: '#3972F6',
    },
  })

  const onSubmit = async (data: TemplateFormData) => {
    if (!session?.user) {
      logger.error('User not authenticated')
      return
    }

    setIsSubmitting(true)

    try {
      // Create the template state from current workflow using the same format as deployment
      const templateState = buildWorkflowStateForTemplate(workflowId)

      const templateData = {
        workflowId,
        name: data.name,
        description: data.description || '',
        author: data.author,
        category: data.category,
        icon: data.icon,
        color: data.color,
        state: templateState,
      }

      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(templateData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create template')
      }

      const result = await response.json()
      logger.info('Template created successfully:', result)

      // Reset form and close modal
      form.reset()
      onOpenChange(false)

      // TODO: Show success toast/notification
    } catch (error) {
      logger.error('Failed to create template:', error)
      // TODO: Show error toast/notification
    } finally {
      setIsSubmitting(false)
    }
  }

  const SelectedIconComponent =
    icons.find((icon) => icon.value === form.watch('icon'))?.component || FileText

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='flex h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Publish Template</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-1 flex-col overflow-hidden'
          >
            <div className='flex-1 overflow-y-auto px-6 py-4'>
              <div className='space-y-6'>
                <div className='flex gap-3'>
                  <FormField
                    control={form.control}
                    name='icon'
                    render={({ field }) => (
                      <FormItem className='w-20'>
                        <FormLabel>Icon</FormLabel>
                        <Popover open={iconPopoverOpen} onOpenChange={setIconPopoverOpen}>
                          <PopoverTrigger asChild>
                            <Button variant='outline' role='combobox' className='h-10 w-20 p-0'>
                              <SelectedIconComponent className='h-4 w-4' />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className='z-50 w-84 p-0' align='start'>
                            <div className='p-3'>
                              <div className='grid max-h-80 grid-cols-8 gap-2 overflow-y-auto'>
                                {icons.map((icon) => {
                                  const IconComponent = icon.component
                                  return (
                                    <button
                                      key={icon.value}
                                      type='button'
                                      onClick={() => {
                                        field.onChange(icon.value)
                                        setIconPopoverOpen(false)
                                      }}
                                      className={cn(
                                        'flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted',
                                        field.value === icon.value &&
                                          'bg-primary text-primary-foreground'
                                      )}
                                    >
                                      <IconComponent className='h-4 w-4' />
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='color'
                    render={({ field }) => (
                      <FormItem className='w-20'>
                        <FormLabel>Color</FormLabel>
                        <FormControl>
                          <ColorPicker
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            className='h-10 w-20'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder='Enter template name' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='grid grid-cols-2 gap-4'>
                  <FormField
                    control={form.control}
                    name='author'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Author</FormLabel>
                        <FormControl>
                          <Input placeholder='Enter author name' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='category'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder='Select a category' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.value} value={category.value}>
                                {category.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='description'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Describe what this template does...'
                          className='resize-none'
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Fixed Footer */}
            <div className='mt-auto border-t px-6 pt-4 pb-6'>
              <div className='flex justify-end'>
                <Button
                  type='submit'
                  disabled={isSubmitting}
                  className={cn(
                    'font-medium',
                    'bg-[#701FFC] hover:bg-[#6518E6]',
                    'shadow-[0_0_0_0_#701FFC] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[#701FFC] disabled:hover:shadow-none',
                    'h-10 rounded-md px-4 py-2'
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Publishing...
                    </>
                  ) : (
                    'Publish'
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
