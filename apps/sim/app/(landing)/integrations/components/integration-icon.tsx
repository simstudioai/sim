import type { ComponentType, ElementType, HTMLAttributes, SVGProps } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface IntegrationIconProps extends HTMLAttributes<HTMLElement> {
  bgColor: string
  /** Integration name — used for the fallback initial letter. */
  name: string
  /** Optional icon component. When absent, renders the first letter of `name`. */
  Icon?: ComponentType<SVGProps<SVGSVGElement>> | null
  /** Tailwind size + rounding classes for the container. Default: `h-10 w-10 rounded-lg` */
  className?: string
  /** Tailwind size classes for the icon SVG. Default: `h-5 w-5` */
  iconClassName?: string
  /** Tailwind text-size class for the fallback letter. Default: `text-[15px]` */
  fallbackClassName?: string
  /** Rendered HTML element. Default: `div` */
  as?: ElementType
}

/**
 * Colored icon box used across integration listing and detail pages.
 * Renders an integration icon over a brand-colored background, falling back
 * to the integration's initial letter when no icon is available.
 */
export function IntegrationIcon({
  bgColor,
  name,
  Icon,
  className,
  iconClassName = 'h-5 w-5',
  fallbackClassName = 'text-[15px]',
  as: Tag = 'div',
  ...rest
}: IntegrationIconProps) {
  return (
    <Tag
      className={cn('flex shrink-0 items-center justify-center', className)}
      style={{ background: bgColor }}
      {...rest}
    >
      {Icon ? (
        <Icon className={cn(iconClassName, 'text-white')} />
      ) : (
        <span className={cn('font-[500] text-white leading-none', fallbackClassName)}>
          {name.charAt(0)}
        </span>
      )}
    </Tag>
  )
}
