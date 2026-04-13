---
name: emcn-design-review
description: Review UI code for alignment with the emcn design system — components, tokens, patterns, and conventions
---

# EMCN Design Review

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses **emcn**, a custom component library built on Radix UI primitives with CVA (class-variance-authority) variants and CSS variable design tokens. All UI must use emcn components and tokens — never raw HTML elements or hardcoded colors.

## Steps

1. Read the emcn barrel export at `apps/sim/components/emcn/components/index.ts` to know what's available
2. Read `apps/sim/app/_styles/globals.css` for the full set of CSS variable tokens
3. Analyze the specified scope against every rule below
4. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.

---

## Imports

- Import components from `@/components/emcn`, never from subpaths
- Import icons from `@/components/emcn/icons` or `lucide-react`
- Import `cn` from `@/lib/core/utils/cn` for conditional class merging
- Import app-specific wrappers (Select, VerifiedBadge) from `@/components/ui`

```tsx
// Good
import { Button, Modal, Badge } from '@/components/emcn'
// Bad
import { Button } from '@/components/emcn/components/button/button'
```

---

## Design Tokens (CSS Variables)

Never use raw color values. Always use CSS variable tokens via Tailwind arbitrary values.

### Text hierarchy
| Token | Use |
|-------|-----|
| `text-[var(--text-primary)]` | Main content text |
| `text-[var(--text-secondary)]` | Secondary/supporting text |
| `text-[var(--text-tertiary)]` | Tertiary text |
| `text-[var(--text-muted)]` | Disabled, placeholder text |
| `text-[var(--text-icon)]` | Icon tinting |
| `text-[var(--text-inverse)]` | Text on dark backgrounds |
| `text-[var(--text-error)]` | Error/warning messages |

### Surfaces (elevation)
| Token | Use |
|-------|-----|
| `bg-[var(--bg)]` | Page background |
| `bg-[var(--surface-2)]` through `bg-[var(--surface-7)]` | Increasing elevation |
| `bg-[var(--surface-hover)]` | Hover state backgrounds |
| `bg-[var(--surface-active)]` | Active/selected backgrounds |

### Borders
| Token | Use |
|-------|-----|
| `border-[var(--border)]` | Default borders |
| `border-[var(--border-1)]` | Stronger borders (inputs, cards) |
| `border-[var(--border-muted)]` | Subtle dividers |

### Status
| Token | Use |
|-------|-----|
| `--success` | Success states |
| `--error` | Error states |
| `--caution` | Warning states |

### Brand
| Token | Use |
|-------|-----|
| `--brand-secondary` | Brand color |
| `--brand-accent` | Accent/CTA color |

### Shadows
Use shadow tokens, never raw box-shadow values:
- `shadow-subtle`, `shadow-medium`, `shadow-overlay`
- `shadow-kbd`, `shadow-card`

### Z-Index
Use z-index tokens for layering:
- `z-[var(--z-dropdown)]` (100), `z-[var(--z-modal)]` (200), `z-[var(--z-popover)]` (300), `z-[var(--z-tooltip)]` (400), `z-[var(--z-toast)]` (500)

---

## Component Usage Rules

### Buttons
Available variants: `default`, `primary`, `destructive`, `ghost`, `outline`, `active`, `secondary`, `tertiary`, `subtle`, `ghost-secondary`, `3d`

| Action type | Variant |
|-------------|---------|
| Primary action (create, save, submit) | `primary` |
| Cancel, close, secondary action | `default` |
| Delete, remove, destructive action | `destructive` |
| Toolbar/icon-only button | `ghost` |
| Toggle, mode switch | `ghost` or `outline` |
| Active/selected state | `active` |

Sizes: `sm` (compact) or `md` (default). Never create custom button styles — use an existing variant.

### Modals (Dialogs)
Use `Modal` + subcomponents. Never build custom dialog overlays.

```tsx
<Modal open={open} onOpenChange={setOpen}>
  <ModalContent size="sm">
    <ModalHeader>Title</ModalHeader>
    <ModalBody>Content</ModalBody>
    <ModalFooter>
      <Button variant="default" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="primary" onClick={handleSubmit}>Save</Button>
    </ModalFooter>
  </ModalContent>
</Modal>
```

Modal sizes: `sm` (440px, confirmations), `md` (500px, forms), `lg` (600px, content-heavy), `xl` (800px, complex editors), `full` (1200px, dashboards).

Footer buttons: Cancel on left, primary action on right.

### Delete Confirmations
Always use Modal with this pattern:

```tsx
<Modal open={open} onOpenChange={setOpen}>
  <ModalContent size="sm">
    <ModalHeader>Delete {itemType}</ModalHeader>
    <ModalBody>
      <p>Description of consequences</p>
      <p className="text-[var(--text-error)]">Warning about irreversibility</p>
      {/* Optional: confirmation text input for high-risk actions */}
    </ModalBody>
    <ModalFooter>
      <Button variant="default" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
        Delete
      </Button>
    </ModalFooter>
  </ModalContent>
</Modal>
```

Rules:
- Title: "Delete {ItemType}"
- Include consequence description
- Use `text-[var(--text-error)]` for warning text
- Destructive button on the right
- For high-risk deletes (workspaces), require typing the name to confirm
- Include recovery info if soft-delete: "You can restore it from Recently Deleted in Settings"

### Toast Notifications
Use the imperative `toast` API. Never build custom notification UI.

```tsx
import { toast } from '@/components/emcn'

toast.success('Item saved')
toast.error('Something went wrong')
toast.success('Deleted', { action: { label: 'Undo', onClick: handleUndo } })
```

Variants: `default`, `success`, `error`. Auto-dismiss after 5s.

### Badges
Use semantic color variants for status:

| Status | Variant |
|--------|---------|
| Success, active, online | `green` |
| Error, failed, offline | `red` |
| Warning, processing | `amber` or `orange` |
| Info, default | `blue` |
| Neutral, draft, inactive | `gray` |
| Type labels | `type` |

Use `dot` prop for status indicators. Use `icon` prop for icon badges.

### Tooltips
Use `Tooltip` from emcn with namespace pattern:

```tsx
<Tooltip.Root>
  <Tooltip.Trigger asChild>
    <Button variant="ghost">{icon}</Button>
  </Tooltip.Trigger>
  <Tooltip.Content>Helpful text</Tooltip.Content>
</Tooltip.Root>
```

Use tooltips for icon-only buttons and truncated text. Don't tooltip self-explanatory elements.

### Popovers
Use for filters, option menus, and nested navigation:

```tsx
<Popover open={open} onOpenChange={setOpen} size="sm">
  <PopoverTrigger asChild>
    <Button variant="ghost">Trigger</Button>
  </PopoverTrigger>
  <PopoverContent side="bottom" align="end" minWidth={160}>
    <PopoverSection>Section Title</PopoverSection>
    <PopoverItem active={isActive} onClick={handleClick}>
      Item Label
    </PopoverItem>
    <PopoverDivider />
  </PopoverContent>
</Popover>
```

### Dropdown Menus
Use for context menus and action menus:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost">
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={handleEdit}>Edit</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={handleDelete} className="text-[var(--text-error)]">
      Delete
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Destructive items go last, after a separator, in error color.

### Forms
Use `FormField` wrapper for labeled inputs:

```tsx
<FormField label="Name" htmlFor="name" error={errors.name} optional>
  <Input id="name" value={name} onChange={e => setName(e.target.value)} />
</FormField>
```

Rules:
- Use `Input` from emcn, never raw `<input>`
- Use `Textarea` from emcn, never raw `<textarea>`
- Use `FormField` for label + input + error layout
- Mark optional fields with `optional` prop
- Show errors inline below the input
- Use `Combobox` for searchable selects
- Use `TagInput` for multi-value inputs

### Loading States
Use `Skeleton` for content placeholders:

```tsx
<Skeleton className="h-5 w-[200px] rounded-md" />
```

Rules:
- Mirror the actual UI structure with skeletons
- Match exact dimensions of the final content
- Use `rounded-md` to match component radius
- Stack multiple skeletons for lists

### Icons
Standard sizing pattern:

```tsx
<Icon className="h-[14px] w-[14px] text-[var(--text-icon)]" />
```

Common sizes: `h-3 w-3` (12px), `h-[14px] w-[14px]`, `h-4 w-4` (16px).

---

## Styling Rules

1. **Use `cn()` for conditional classes**: `cn('base', condition && 'conditional')`
2. **Never use inline styles**: Use Tailwind classes exclusively
3. **Never hardcode colors**: Use CSS variable tokens (`var(--text-primary)`, not `#333`)
4. **Never use global styles**: Keep all styling local to components
5. **Hover states**: Use `hover-hover:` pseudo-class for hover-capable devices
6. **Transitions**: Use `transition-colors` for color changes, `transition-colors duration-100` for fast hover
7. **Border radius**: `rounded-lg` (large cards), `rounded-md` (medium), `rounded-sm` (small), `rounded-xs` (tiny)
8. **Typography**: Use semantic sizes — `text-small` (13px), `text-caption` (12px), `text-xs` (11px), `text-micro` (10px)
9. **Font weight**: Use `font-medium` for emphasis, avoid `font-bold` unless for headings
10. **Spacing**: Use Tailwind gap/padding utilities. Common patterns: `gap-2`, `gap-3`, `px-4 py-2.5`

---

## Anti-patterns to flag

- Raw HTML elements (`<button>`, `<input>`, `<dialog>`) instead of emcn components
- Hardcoded color values (`#fff`, `rgb(0,0,0)`, `text-gray-500`)
- Custom modal/dialog implementations instead of `Modal`
- Custom toast/notification implementations instead of `toast`
- Inline styles (`style={{ color: 'red' }}`)
- Missing `cn()` for conditional classes (string concatenation instead)
- Wrong button variant for the action type
- Missing loading/skeleton states
- Missing error states on forms
- Using `@/components/ui/button` when `@/components/emcn` Button should be used
- Importing from emcn subpaths instead of barrel
- Using `z-50`, `z-[9999]` instead of z-index tokens
- Custom shadows instead of shadow tokens
