import { cva, type VariantProps } from 'class-variance-authority'

const variants = {
  primary:
    'bg-fd-primary text-fd-primary-foreground rounded-full font-[500] hover:bg-fd-primary/80',
  outline: 'border rounded-md hover:bg-fd-accent hover:text-fd-accent-foreground',
  ghost: 'rounded-md hover:bg-fd-accent hover:text-fd-accent-foreground',
  secondary:
    'border rounded-md bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground',
} as const

export const buttonVariants = cva(
  'inline-flex items-center justify-center p-2 text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring',
  {
    variants: {
      variant: variants,
      color: variants,
      size: {
        sm: 'gap-1 px-3 py-1.5 text-xs',
        md: 'gap-2 px-5 py-2 text-sm',
        icon: 'p-1.5 [&_svg]:size-5',
        'icon-sm': 'p-1.5 [&_svg]:size-4.5',
        'icon-xs': 'p-1 [&_svg]:size-4',
      },
    },
  }
)

export type ButtonProps = VariantProps<typeof buttonVariants>
