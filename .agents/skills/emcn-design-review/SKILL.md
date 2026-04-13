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

Never use raw color values. Always use CSS variable tokens via Tailwind arbitrary values: `text-[var(--text-primary)]`, not `text-gray-500` or `#333`. The CSS variable pattern is canonical (1,700+ uses) — do not use Tailwind semantic classes like `text-muted-foreground`.

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

| Action type | Variant | Frequency |
|-------------|---------|-----------|
| Toolbar, icon-only, utility actions | `ghost` | Most common (28%) |
| Primary action (create, save, submit) | `primary` | Very common (24%) |
| Cancel, close, secondary action | `default` | Common |
| Delete, remove, destructive action | `destructive` | Targeted use only |
| Active/selected state | `active` | Targeted use only |
| Toggle, mode switch | `outline` | Moderate |

Sizes: `sm` (compact, 32% of buttons) or `md` (default, used when no size specified). Never create custom button styles — use an existing variant.

Buttons without an explicit variant prop get `default` styling. This is acceptable for cancel/secondary actions.

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

Modal sizes by frequency: `sm` (440px, most common — confirmations and simple dialogs), `md` (500px, forms), `lg` (600px, content-heavy), `xl` (800px, rare), `full` (1200px, rare).

Footer buttons: Cancel on left (`variant="default"`), primary action on right. This pattern is followed 100% across the codebase.

### Delete/Remove Confirmations
Always use Modal with `size="sm"`. The established pattern:

```tsx
<Modal open={open} onOpenChange={setOpen}>
  <ModalContent size="sm">
    <ModalHeader>Delete {itemType}</ModalHeader>
    <ModalBody>
      <p>Description of consequences</p>
      <p className="text-[var(--text-error)]">Warning about irreversibility</p>
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
- Title: "Delete {ItemType}" or "Remove {ItemType}" (use "Remove" for membership/association changes)
- Include consequence description
- Use `text-[var(--text-error)]` for warning text when the action is irreversible
- `variant="destructive"` for the action button (100% compliance)
- `variant="default"` for cancel (100% compliance)
- Cancel left, destructive right (100% compliance)
- For high-risk deletes (workspaces), require typing the name to confirm
- Include recovery info if soft-delete: "You can restore it from Recently Deleted in Settings"

### Toast Notifications
Use the imperative `toast` API from `@/components/emcn`. Never build custom notification UI.

```tsx
import { toast } from '@/components/emcn'

toast.success('Item saved')
toast.error('Something went wrong')
toast.success('Deleted', { action: { label: 'Undo', onClick: handleUndo } })
```

Variants: `default`, `success`, `error`. Auto-dismiss after 5s. Supports optional action buttons with callbacks.

### Badges
Use semantic color variants for status:

| Status | Variant | Usage |
|--------|---------|-------|
| Error, failed, disconnected | `red` | Most common (15 uses) |
| Metadata, roles, auth types, scopes | `gray-secondary` | Very common (12 uses) |
| Type annotations (TS types, field types) | `type` | Very common (12 uses) |
| Success, active, enabled, running | `green` | Common (7 uses) |
| Neutral, default, unknown | `gray` | Common (6 uses) |
| Outline, parameters, public | `outline` | Moderate (6 uses) |
| Warning, processing | `amber` | Moderate (5 uses) |
| Paused, warning | `orange` | Occasional |
| Info, queued | `blue` | Occasional |
| Data types (arrays) | `purple` | Occasional |
| Generic with border | `default` | Occasional |

Use `dot` prop for status indicators (19 instances in codebase). `icon` prop is available but rarely used.

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
      <MoreHorizontal className="h-[14px] w-[14px]" />
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
- Use `Input` from emcn, never raw `<input>` (exception: hidden file inputs)
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
Standard sizing — `h-[14px] w-[14px]` is the dominant pattern (400+ uses):

```tsx
<Icon className="h-[14px] w-[14px] text-[var(--text-icon)]" />
```

Size scale by frequency:
1. `h-[14px] w-[14px]` — default for inline icons (most common)
2. `h-[16px] w-[16px]` — slightly larger inline icons
3. `h-3 w-3` (12px) — compact/tight spaces
4. `h-4 w-4` (16px) — Tailwind equivalent, also common
5. `h-3.5 w-3.5` (14px) — Tailwind equivalent of 14px
6. `h-5 w-5` (20px) — larger icons, section headers

Use `text-[var(--text-icon)]` for icon color (113+ uses in codebase).

---

## Styling Rules

1. **Use `cn()` for conditional classes**: `cn('base', condition && 'conditional')` — never template literal concatenation like `` `base ${condition ? 'active' : ''}` ``
2. **Inline styles**: Avoid. Exception: dynamic values that can't be expressed as Tailwind classes (e.g., `style={{ width: dynamicVar }}` or CSS variable references). Never use inline styles for colors or static values.
3. **Never hardcode colors**: Use CSS variable tokens. Never `text-gray-500`, `bg-red-100`, `#fff`, or `rgb()`. Always `text-[var(--text-*)]`, `bg-[var(--surface-*)]`, etc.
4. **Never use Tailwind semantic color classes**: Use `text-[var(--text-muted)]` not `text-muted-foreground`. The CSS variable pattern is canonical.
5. **Never use global styles**: Keep all styling local to components
6. **Hover states**: Use `hover-hover:` pseudo-class for hover-capable devices
7. **Transitions**: Use `transition-colors` for color changes, `transition-colors duration-100` for fast hover
8. **Border radius**: `rounded-lg` (large cards), `rounded-md` (medium), `rounded-sm` (small), `rounded-xs` (tiny)
9. **Typography**: Use semantic sizes — `text-small` (13px), `text-caption` (12px), `text-xs` (11px), `text-micro` (10px)
10. **Font weight**: Use `font-medium` for emphasis, avoid `font-bold` unless for headings
11. **Spacing**: Use Tailwind gap/padding utilities. Common patterns: `gap-2`, `gap-3`, `px-4 py-2.5`

---

## Anti-patterns to flag

- Raw HTML `<button>` instead of Button component (exception: inside Radix primitives)
- Raw HTML `<input>` instead of Input component (exception: hidden file inputs, read-only checkboxes in markdown)
- Hardcoded Tailwind default colors (`text-gray-*`, `bg-red-*`, `text-blue-*`)
- Hex values in className (`bg-[#fff]`, `text-[#333]`)
- Tailwind semantic classes (`text-muted-foreground`) instead of CSS variables (`text-[var(--text-muted)]`)
- Custom modal/dialog implementations instead of `Modal`
- Custom toast/notification implementations instead of `toast`
- Inline styles for colors or static values (dynamic values are acceptable)
- Template literal className concatenation instead of `cn()`
- Wrong button variant for the action type
- Missing loading/skeleton states
- Missing error states on forms
- Importing from emcn subpaths instead of barrel export
- Using arbitrary z-index (`z-50`, `z-[9999]`) instead of z-index tokens
- Custom shadows instead of shadow tokens
- Icon sizes that don't follow the established scale (default to `h-[14px] w-[14px]`)
