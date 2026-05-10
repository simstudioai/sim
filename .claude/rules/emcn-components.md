---
paths:
  - "apps/sim/components/emcn/**"
---

# EMCN Components

Import from `@/components/emcn`, never from subpaths (except CSS files).

## CVA vs Direct Styles

**Use CVA when:** 2+ variants (primary/secondary, sm/md/lg)

```tsx
const buttonVariants = cva('base-classes', {
  variants: { variant: { default: '...', primary: '...' } }
})
export { Button, buttonVariants }
```

**Use direct className when:** Single consistent style, no variations

```tsx
function Label({ className, ...props }) {
  return <Primitive className={cn('style-classes', className)} {...props} />
}
```

## Rules

- Use Radix UI primitives for accessibility
- Export component and variants (if using CVA)
- TSDoc with usage examples
- Consistent tokens: `font-medium`, `text-[12px]`, `rounded-[4px]`
- Equal height/width → `size-*` (e.g. `size-[14px]`, `size-4`), never `h-[Npx] w-[Npx]` or `h-N w-N`. Default icon size is `size-[14px]`
- `transition-colors` for hover states
