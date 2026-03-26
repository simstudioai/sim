# EMCN Design System Reference

Complete reference for the EMCN component library, semantic design tokens, and Tailwind configuration. Use `@/components/emcn` as the single import path for all components.

---

## Table of Contents

1. [Semantic Tokens](#semantic-tokens)
2. [Tailwind Configuration](#tailwind-configuration)
3. [Component Reference](#component-reference)
4. [Icons](#icons)

---

## Semantic Tokens

All color values are CSS custom properties defined in `app/_styles/globals.css` under `:root` (light) and `.dark` selectors. Reference them with `var(--token-name)` in CSS or `[var(--token-name)]` in Tailwind arbitrary values.

### Surface / Background

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | `#fefefe` | `#1b1b1b` | Main canvas background |
| `--surface-1` | `#f9f9f9` | `#1e1e1e` | Sidebar, panels |
| `--surface-2` | `#ffffff` | `#232323` | Blocks, cards, modals |
| `--surface-3` | `#f7f7f7` | `#242424` | Popovers, headers |
| `--surface-4` | `#f5f5f5` | `#292929` | Button base, badge backgrounds |
| `--surface-5` | `#f3f3f3` | `#363636` | Inputs, form elements |
| `--surface-6` | `#e5e5e5` | `#454545` | Elevated surfaces, hover states |
| `--surface-7` | `#d9d9d9` | `#505050` | Strong hover states |
| `--surface-active` | `#ececec` | `#2c2c2c` | Active/pressed state, skeleton bg |

### Text

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--text-primary` | `#1a1a1a` | `#e6e6e6` | Headings, primary content |
| `--text-secondary` | `#525252` | `#cccccc` | Secondary content, descriptions |
| `--text-tertiary` | `#5c5c5c` | `#b3b3b3` | Tertiary labels, breadcrumbs |
| `--text-muted` | `#707070` | `#787878` | Muted text, placeholders in components |
| `--text-subtle` | `#8c8c8c` | `#7d7d7d` | Very low-emphasis text |
| `--text-body` | `#3b3b3b` | `#cdcdcd` | Body text, popover items |
| `--text-icon` | `#5e5e5e` | `#939393` | Icon default color |
| `--text-inverse` | `#ffffff` | `#1b1b1b` | Text on dark/light inverted backgrounds |
| `--text-muted-inverse` | `#a0a0a0` | `#b3b3b3` | Muted text on inverted backgrounds |
| `--text-error` | `#ef4444` | `#ef4444` | Error messages, required indicators |
| `--text-placeholder` | `#8d8d8d` | `#8d8d8d` | Input placeholder text |
| `--text-success` | `#22c55e` | `#22c55e` | Success text |

### Border / Divider

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--border` | `#dedede` | `#333333` | Primary border (default for all `*` elements) |
| `--border-1` | `#e0e0e0` | `#3d3d3d` | Stronger border, input borders, active states |
| `--border-muted` | `#e4e4e4` | `#424242` | Subtle borders |
| `--border-success` | `#e0e0e0` | `#575757` | Success state borders |
| `--divider` | `#ededed` | `#393939` | Section dividers |

### Brand / State

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--brand-secondary` | `#33b4ff` | `#33b4ff` | Selection highlights, secondary brand |
| `--brand-accent` | `#33c482` | `#33c482` | Tertiary button, accent green |
| `--selection` | `#1a5cf6` | `#4b83f7` | Text selection |
| `--warning` | `#ea580c` | `#ff6600` | Warning state |

### Semantic Status

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--error` | `#dc2626` | `#f87171` | Error indicators |
| `--error-muted` | `#fecaca` | `#f6d2d2` | Muted error backgrounds |
| `--error-emphasis` | `#b91c1c` | `#b91c1c` | Strong error emphasis |
| `--caution` | `#f59e0b` | `#f59e0b` | Warning/caution indicators |
| `--success` | `#22c55e` | `#22c55e` | Success indicators |

### Badge Colors

Each badge color has `-bg` and `-text` variants. Used by the Badge component's color variants.

| Base | Light BG | Light Text | Dark BG | Dark Text |
|---|---|---|---|---|
| `success` | `#bbf7d0` | `#15803d` | `rgba(34,197,94,0.2)` | `#86efac` |
| `error` | `#fecaca` | `#dc2626` | `#551a1a` | `#fca5a5` |
| `gray` | `#e7e5e4` | `#57534e` | `#3a3a3a` | `#a8a8a8` |
| `blue` | `#bfdbfe` | `#1d4ed8` | `rgba(59,130,246,0.2)` | `#93c5fd` |
| `blue-secondary` | `#bae6fd` | `#0369a1` | `rgba(51,180,255,0.2)` | `#7dd3fc` |
| `purple` | `#e9d5ff` | `#7c3aed` | `rgba(168,85,247,0.2)` | `#d8b4fe` |
| `orange` | `#fed7aa` | `#c2410c` | `rgba(249,115,22,0.2)` | `#fdba74` |
| `amber` | `#fde68a` | `#a16207` | `rgba(245,158,11,0.2)` | `#fcd34d` |
| `teal` | `#99f6e4` | `#0f766e` | `rgba(20,184,166,0.2)` | `#5eead4` |
| `cyan` | `#cffafe` | `#0891b2` | `rgba(14,165,233,0.2)` | `#7dd3fc` |
| `pink` | `#fbcfe8` | `#be185d` | `rgba(236,72,153,0.2)` | `#f9a8d4` |

### Font Weights

Weights are theme-aware to compensate for light-on-dark rendering differences.

| Token | Light | Dark | Tailwind Class |
|---|---|---|---|
| `--font-weight-base` | `420` | `420` | `font-base` |
| `--font-weight-medium` | `440` | `480` | `font-medium` |
| `--font-weight-semibold` | `500` | `550` | `font-semibold` |

### Shadows

Defined in `:root` and overridden for `.dark` where applicable.

| Token | Value | Tailwind Class |
|---|---|---|
| `--shadow-subtle` | `0 2px 4px 0 rgba(0,0,0,0.08)` | `shadow-subtle` |
| `--shadow-medium` | `0 4px 12px rgba(0,0,0,0.1)` | `shadow-medium` |
| `--shadow-overlay` | `0 16px 48px rgba(0,0,0,0.15)` | `shadow-overlay` |
| `--shadow-kbd` | `0 4px 0 0 rgba(48,48,48,1)` | `shadow-kbd` |
| `--shadow-kbd-sm` | `0 2px 0 0 rgba(48,48,48,1)` | `shadow-kbd-sm` |
| `--shadow-brand-inset` | `inset 0 1.25px 2.5px 0 #9b77ff` | `shadow-brand-inset` |
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.04)` | `shadow-card` |

### Z-Index Scale

| Token | Value | Usage |
|---|---|---|
| `--z-dropdown` | `100` | Dropdown menus |
| `--z-modal` | `200` | Modal overlays |
| `--z-popover` | `300` | Popovers (above modals for nested use) |
| `--z-tooltip` | `400` | Tooltips |
| `--z-toast` | `500` | Toast notifications |

### Indicators

| Token | Value | Usage |
|---|---|---|
| `--indicator-online` | `#33c482` | Online status dot |
| `--indicator-active` | `#4ade80` | Active state |
| `--indicator-inactive` | `#b7b7b7` | Inactive/offline |
| `--indicator-seat-filled` | `#34b5ff` | Occupied seat indicator |

### Code Editor

| Token | Light | Dark |
|---|---|---|
| `--code-bg` | `#f5f5f5` | `#1f1f1f` |
| `--code-foreground` | `#1a1a1a` | `#eeeeee` |
| `--code-line-number` | `#737373` | `#a8a8a8` |

---

## Tailwind Configuration

Defined in `tailwind.config.ts`. Key extensions to the default theme:

### Dark Mode

```ts
darkMode: ['class'] // Toggle via .dark class on <html>
```

### Font Families

| Class | Stack |
|---|---|
| `font-season` | Custom variable font (`var(--font-season)`) |
| `font-body` | System sans-serif stack |
| `font-mono` | Martian Mono + system monospace fallbacks |

### Font Sizes

| Class | Size | Usage |
|---|---|---|
| `text-micro` | `10px` | Micro labels |
| `text-xs` | `11px` | Small labels, button text `sm` |
| `text-caption` | `12px` | Captions, button group text, badge `md`/`lg` |
| `text-small` | `13px` | Labels, tag text |
| `text-base` | `15px` | Body text, branded buttons |
| `text-md` | `16px` | Larger body text |

### Border Radius

| Class | Value |
|---|---|
| `rounded-xs` | `2px` |
| `rounded-sm` | `calc(var(--radius) - 4px)` = `4px` |
| `rounded-md` | `calc(var(--radius) - 2px)` = `6px` |
| `rounded-lg` | `var(--radius)` = `8px` |

### Custom Variant: `hover-hover`

Applies hover styles only on devices with fine pointers and hover capability. Prevents sticky hover on touch devices.

```tsx
// Usage
<div className="hover-hover:bg-[var(--surface-6)]" />
```

### Animations

| Class | Duration | Usage |
|---|---|---|
| `animate-caret-blink` | `1.25s` | OTP input caret |
| `animate-slide-left` | `80s` | Infinite slide left (landing) |
| `animate-slide-right` | `80s` | Infinite slide right (landing) |
| `animate-placeholder-pulse` | `1.5s` | Loading placeholder opacity |
| `animate-ring-pulse` | `1.5s` | Border success pulse |
| `animate-stream-fade-in` | `300ms` | Streaming content fade-in |
| `animate-thinking-block` | `1.6s` | AI thinking indicator |
| `animate-slide-in-right` | `350ms` | Panel slide-in |
| `animate-slide-in-bottom` | `400ms` | Content slide-in from bottom |
| `animate-tour-tooltip-in` | `200ms` | Tour tooltip entrance |
| `animate-collapsible-down` | `300ms` | Expandable open |
| `animate-collapsible-up` | `300ms` | Expandable close |

---

## Component Reference

All components are imported from `@/components/emcn`. Never import from subpaths (except CSS files).

```tsx
import { Button, Input, Badge, Tooltip } from '@/components/emcn'
```

### Button

Versatile button with 12 visual variants and 3 sizes.

**Variants:** `default` | `active` | `3d` | `outline` | `primary` | `destructive` | `secondary` | `tertiary` | `ghost` | `subtle` | `ghost-secondary` | `branded`

**Sizes:** `sm` (11px) | `md` (12px, default) | `branded` (login form)

```tsx
<Button variant="primary" size="md">Save</Button>
<Button variant="destructive">Delete</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="3d">Elevated</Button>
<Button variant="branded" size="branded" className="branded-button-gradient">Sign Up</Button>
```

| Variant | Background | Text | Border | Notes |
|---|---|---|---|---|
| `default` | `--surface-4` | `--text-secondary` | `--border` | Neutral, most common |
| `active` | `--surface-5` | `--text-primary` | `--border-1` | Selected/active state |
| `3d` | transparent | `--text-tertiary` | `--border-1` | Raised shadow effect |
| `outline` | transparent | `--text-secondary` | `--text-muted` | Bordered, no fill |
| `primary` | `--text-primary` | `--text-inverse` | none | High emphasis CTA |
| `destructive` | `--text-error` | white | none | Danger actions |
| `secondary` | `--brand-secondary` | `--text-primary` | none | Brand blue |
| `tertiary` | `--brand-accent` | `--text-inverse` | none | Brand green |
| `ghost` | transparent | `--text-secondary` | none | Minimal, text only |
| `subtle` | transparent | `--text-body` | none | Subtle hover background |
| `ghost-secondary` | transparent | `--text-muted` | none | Extra-low emphasis |
| `branded` | via CSS class | white | theme | Requires `branded-button-gradient` or `branded-button-custom` class |

**Exports:** `Button`, `ButtonProps`, `buttonVariants`

---

### ButtonGroup

Connected toggle group where one item is selected at a time.

**Gap:** `none` | `sm` (default)

```tsx
<ButtonGroup value={lang} onValueChange={setLang}>
  <ButtonGroupItem value="curl">cURL</ButtonGroupItem>
  <ButtonGroupItem value="python">Python</ButtonGroupItem>
</ButtonGroup>
```

**Exports:** `ButtonGroup`, `ButtonGroupItem`, `ButtonGroupProps`, `ButtonGroupItemProps`, `buttonGroupVariants`, `buttonGroupItemVariants`

---

### Input

Text input with variant and size support.

**Variants:** `default` | `error` | `ghost`

**Sizes:** `sm` (12px) | `md` (14px, default)

```tsx
<Input placeholder="Enter text..." />
<Input variant="error" placeholder="Invalid value" />
<Input variant="ghost" placeholder="Inline edit..." />
<Input size="sm" placeholder="Compact" />
```

| Variant | Background | Border | Focus |
|---|---|---|---|
| `default` | `--surface-5` | `--border-1` | border -> `--text-muted` |
| `error` | `--surface-5` | `--text-error` | stays `--text-error` |
| `ghost` | transparent | transparent | border -> `--border-1`, bg -> `--surface-5` |

**Exports:** `Input`, `InputProps`, `inputVariants`

---

### Textarea

Multi-line text input with variant support.

**Variants:** `default` | `error` | `ghost`

```tsx
<Textarea placeholder="Enter message..." rows={4} />
<Textarea variant="error" placeholder="Invalid content" />
<Textarea variant="ghost" placeholder="Inline edit..." />
```

**Exports:** `Textarea`, `TextareaProps`, `textareaVariants`

---

### Badge

Inline status label with extensive color variants.

**Variants:** `default` | `outline` | `type` | `green` | `red` | `gray` | `blue` | `blue-secondary` | `purple` | `orange` | `amber` | `teal` | `cyan` | `pink` | `gray-secondary`

**Sizes:** `sm` | `md` (default) | `lg`

**Props:** `dot?: boolean` (color variants only), `icon?: ComponentType`

```tsx
<Badge variant="green" dot>Active</Badge>
<Badge variant="red" size="sm">Error</Badge>
<Badge variant="blue" icon={InfoIcon}>Info</Badge>
```

**Exports:** `Badge`, `BadgeProps`, `badgeVariants`

---

### Checkbox

Radix-based checkbox with size variants.

**Sizes:** `sm` (14px) | `md` (16px, default) | `lg` (20px)

```tsx
<Checkbox checked={value} onCheckedChange={setValue} />
<Checkbox size="sm" />
<Checkbox size="lg" />
<Checkbox disabled checked />
```

**Exports:** `Checkbox`, `CheckboxProps`, `checkboxVariants`, `checkboxIconVariants`

---

### Switch

Toggle switch with size variants. Uses `--text-primary` for checked state.

**Sizes:** `sm` (14px height) | `md` (20px, default) | `lg` (24px)

```tsx
<Switch checked={on} onCheckedChange={setOn} />
<Switch size="sm" />
<Switch size="lg" />
<Switch disabled />
```

**Exports:** `Switch`, `SwitchProps`, `switchVariants`, `switchThumbVariants`

---

### Label

Form label with size variants and required indicator.

**Sizes:** `sm` (11px) | `md` (13px, default) | `lg` (15px)

**Props:** `required?: boolean` (shows red asterisk)

```tsx
<Label htmlFor="email">Email</Label>
<Label required>Name</Label>
<Label size="sm">Caption</Label>
```

**Exports:** `Label`, `LabelProps`, `labelVariants`

---

### FormField

Labeled field wrapper with error display.

**Props:** `label`, `htmlFor?`, `optional?`, `error?`, `children`

```tsx
<FormField label="Email" htmlFor="email" error="Required">
  <Input id="email" variant="error" />
</FormField>
<FormField label="Bio" optional>
  <Textarea />
</FormField>
```

**Exports:** `FormField`, `FormFieldProps`

---

### Slider

Range slider with size variants.

**Sizes:** `sm` | `md` (default) | `lg`

```tsx
<Slider value={[50]} onValueChange={setValue} min={0} max={100} />
<Slider size="sm" value={[30]} />
<Slider size="lg" value={[70]} />
```

**Exports:** `Slider`, `SliderProps`

---

### Avatar

User avatar with image, fallback, and status indicator.

**Sizes:** `xs` (14px) | `sm` (24px) | `md` (32px, default) | `lg` (40px)

**Status:** `online` | `offline` | `busy` | `away`

```tsx
<Avatar size="lg" status="online">
  <AvatarImage src="/photo.jpg" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

**Exports:** `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarProps`, `avatarVariants`, `avatarStatusVariants`

---

### Skeleton

Loading placeholder with shape variants.

**Variants:** `line` (default, rounded-md) | `circle` (rounded-full) | `rectangle` (rounded-sm)

```tsx
<Skeleton className="h-4 w-48" />
<Skeleton variant="circle" className="h-8 w-8" />
<Skeleton variant="rectangle" className="h-20 w-full" />
```

**Exports:** `Skeleton`, `SkeletonProps`, `skeletonVariants`

---

### Banner

Full-width notification banner with semantic variants.

**Variants:** `default` | `destructive` | `warning` | `info` | `success`

**Props:** `text?`, `actionLabel?`, `onAction?`, `actionVariant?`, `children?`

```tsx
<Banner text="Changes saved" variant="success" />
<Banner text="Error occurred" variant="destructive" actionLabel="Retry" onAction={retry} />
```

**Exports:** `Banner`, `BannerProps`

---

### TagInput

Input for managing tag lists with validation.

**Tag Variants:** `default` (blue) | `secondary` (bordered) | `invalid` (red)

**Props:** `items`, `onAdd`, `onRemove`, `tagVariant?`, `fileInputOptions?`, `triggerKeys?`

```tsx
<TagInput
  items={tags}
  onAdd={(v) => { addTag(v); return isValid(v) }}
  onRemove={(v, i) => removeTag(i)}
  tagVariant="secondary"
/>
```

**Exports:** `Tag`, `TagInput`, `TagItem`, `TagProps`, `TagInputProps`, `tagVariants`, `tagInputVariants`, `FileInputOptions`

---

### Combobox

Dropdown select with search, multi-select, and editable modes.

**Sizes:** `sm` | `md` (default)

**Modes:** Standard, `searchable`, `editable`, `multiSelect`

```tsx
<Combobox options={opts} value={val} onChange={setVal} placeholder="Select..." />
<Combobox options={opts} value="" onChange={() => {}} searchable size="sm" />
<Combobox options={opts} multiSelect multiSelectValues={[]} onMultiSelectChange={setVals} />
```

**Exports:** `Combobox`, `ComboboxOption`, `ComboboxOptionGroup`

---

### DatePicker

Calendar dropdown for date and date-range selection.

**Sizes:** `default` | `sm`

**Modes:** `single` (default), `range`, `inline`

```tsx
<DatePicker value={date} onChange={setDate} placeholder="Select date" />
<DatePicker mode="range" startDate={start} endDate={end} onRangeChange={handleRange} />
<DatePicker inline value={date} onChange={setDate} />
```

**Exports:** `DatePicker`, `DatePickerProps`, `datePickerVariants`

---

### TimePicker

Time selection dropdown with 12h display.

**Sizes:** `default` | `sm`

```tsx
<TimePicker value={time} onChange={setTime} placeholder="Select time" />
<TimePicker size="sm" value="14:00" />
```

**Exports:** `TimePicker`, `TimePickerProps`, `timePickerVariants`

---

### Tooltip

Compound tooltip component with shortcut and preview support.

**Sub-components:** `Tooltip.Root`, `Tooltip.Trigger`, `Tooltip.Content`, `Tooltip.Provider`, `Tooltip.Shortcut`, `Tooltip.Preview`

```tsx
<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <Button>Hover me</Button>
    </Tooltip.Trigger>
    <Tooltip.Content>
      <Tooltip.Shortcut keys="⌘S">Save</Tooltip.Shortcut>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
```

**Exports:** `Tooltip`

---

### Popover

Navigation popover with folder drill-down, search, and scroll area.

**Sizes:** `sm` | `md` (default)

**Color Schemes:** `default` | `inverted`

**Variants:** `default` | `secondary`

**Sub-components:** `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`, `PopoverItem`, `PopoverFolder`, `PopoverBackButton`, `PopoverSearch`, `PopoverSection`, `PopoverDivider`, `PopoverScrollArea`

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button>Open</Button>
  </PopoverTrigger>
  <PopoverContent>
    <PopoverSearch placeholder="Search..." />
    <PopoverScrollArea className="max-h-40">
      <PopoverItem>Item 1</PopoverItem>
      <PopoverItem active>Selected Item</PopoverItem>
    </PopoverScrollArea>
  </PopoverContent>
</Popover>
```

---

### DropdownMenu

Full-featured dropdown menu built on Radix UI primitives.

**Sub-components:** `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuRadioGroup`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuGroup`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuPortal`, `DropdownMenuSearchInput`

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button>Options</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuLabel>Actions</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem>Edit</DropdownMenuItem>
    <DropdownMenuItem>Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

### Modal

Dialog component with optional tabs. Uses Radix Dialog primitives.

**Content Sizes:** `sm` | `md` | `lg` | `xl` | `full`

**Sub-components:** `Modal`, `ModalTrigger`, `ModalContent`, `ModalHeader`, `ModalBody`, `ModalFooter`, `ModalClose`, `ModalOverlay`, `ModalPortal`, `ModalTitle`, `ModalDescription`, `ModalTabs`, `ModalTabsList`, `ModalTabsTrigger`, `ModalTabsContent`

```tsx
<Modal>
  <ModalTrigger asChild>
    <Button>Open</Button>
  </ModalTrigger>
  <ModalContent size="md">
    <ModalHeader>Title</ModalHeader>
    <ModalBody>Content</ModalBody>
    <ModalFooter>
      <Button variant="primary">Save</Button>
    </ModalFooter>
  </ModalContent>
</Modal>
```

---

### SModal (Sidebar Modal)

Dialog with sidebar navigation for settings-style UIs.

**Sub-components:** `SModal`, `SModalTrigger`, `SModalContent`, `SModalSidebar`, `SModalSidebarHeader`, `SModalSidebarSection`, `SModalSidebarSectionTitle`, `SModalSidebarItem`, `SModalMain`, `SModalMainHeader`, `SModalMainBody`, `SModalClose`, `SModalTabs`, `SModalTabsList`, `SModalTabsTrigger`, `SModalTabsContent`, `SModalTabsBody`

```tsx
<SModal>
  <SModalTrigger asChild>
    <Button>Settings</Button>
  </SModalTrigger>
  <SModalContent>
    <SModalSidebar>
      <SModalSidebarHeader>Settings</SModalSidebarHeader>
      <SModalSidebarSection>
        <SModalSidebarSectionTitle>Account</SModalSidebarSectionTitle>
        <SModalSidebarItem icon={<User />} active>Profile</SModalSidebarItem>
      </SModalSidebarSection>
    </SModalSidebar>
    <SModalMain>
      <SModalMainHeader>Profile</SModalMainHeader>
      <SModalMainBody>Content</SModalMainBody>
    </SModalMain>
  </SModalContent>
</SModal>
```

---

### Code

Syntax-highlighted code viewer with line numbers, search, and JSON folding.

**Compound object:** `Code.Container`, `Code.Content`, `Code.Gutter`, `Code.Placeholder`, `Code.Viewer` (standard + virtualized)

```tsx
// Simple viewer
<Code.Viewer code={sourceCode} language="javascript" showGutter />

// With text wrapping
<Code.Viewer code={longLine} language="json" wrapText />
```

**Supported languages:** JavaScript, TypeScript, JSON, Python, HTML, CSS, Markdown, Bash, YAML, SQL, and more via PrismJS.

**Exports:** `Code`, `CODE_LINE_HEIGHT_PX`, `calculateGutterWidth`, `getCodeEditorProps`, `highlight`, `languages`

---

### Expandable

Animated collapsible content using Radix Collapsible.

```tsx
<Expandable expanded={isOpen}>
  <ExpandableContent>
    <p>Animated content</p>
  </ExpandableContent>
</Expandable>
```

**Exports:** `Expandable`, `ExpandableContent`

---

### Breadcrumb

Navigation breadcrumb with link and text items.

```tsx
<Breadcrumb items={[
  { label: 'Home', href: '/' },
  { label: 'Settings', href: '/settings' },
  { label: 'Profile' },
]} />
```

**Exports:** `Breadcrumb`, `BreadcrumbItem`, `BreadcrumbProps`

---

### Table

Standard HTML table with consistent styling.

**Sub-components:** `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Alice</TableCell>
      <TableCell>Active</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

---

### InputOTP

OTP verification input using `input-otp` library.

```tsx
<InputOTP maxLength={6}>
  <InputOTPGroup>
    <InputOTPSlot index={0} />
    <InputOTPSlot index={1} />
    <InputOTPSlot index={2} />
  </InputOTPGroup>
  <InputOTPSeparator />
  <InputOTPGroup>
    <InputOTPSlot index={3} />
    <InputOTPSlot index={4} />
    <InputOTPSlot index={5} />
  </InputOTPGroup>
</InputOTP>
```

**Exports:** `InputOTP`, `InputOTPGroup`, `InputOTPSeparator`, `InputOTPSlot`

---

### Toast

Imperative toast notification system.

```tsx
// Wrap app with provider
<ToastProvider />

// Call from anywhere
import { toast } from '@/components/emcn'

toast('Changes saved', {
  type: 'success',
  duration: 3000,
})
```

**Exports:** `ToastProvider`, `toast`, `useToast`, `CountdownRing`

---

### TourTooltip

Positioned tooltip for product tours.

```tsx
<TourTooltip
  targetRef={buttonRef}
  placement="bottom"
  title="Welcome"
  description="Click here to get started"
  onNext={nextStep}
  onDismiss={endTour}
/>
```

**Exports:** `TourTooltip`, `TourTooltipProps`, `TourTooltipPlacement`, `TourCard`, `TourCardProps`

---

## Icons

Custom SVG icons are imported from `@/components/emcn`. They accept standard `SVGProps<SVGSVGElement>`.

### Available Icons

`BubbleChatClose`, `BubbleChatPreview`, `Card`, `ChevronDown`, `Connections`, `Copy`, `Cursor`, `DocumentAttachment`, `Download`, `Duplicate`, `Expand`, `Eye`, `FolderCode`, `FolderPlus`, `Hand`, `HexSimple`, `Key`, `Layout`, `Library`, `Loader`, `MoreHorizontal`, `NoWrap`, `PanelLeft`, `Play`, `PlayOutline`, `Redo`, `Rocket`, `Trash`, `Trash2`, `Undo`, `Wrap`, `ZoomIn`, `ZoomOut`

Some icons have CSS module animations: `Copy`, `Download`, `Layout`, `Loader`.

```tsx
import { Copy, Loader, Play } from '@/components/emcn'

<Copy className="h-4 w-4 text-[var(--text-icon)]" />
```

---

## Styling Guidelines

1. **Always use semantic tokens** (`var(--text-primary)`) over raw colors
2. **Use `hover-hover:`** instead of `hover:` for interactive states (prevents sticky hover on touch)
3. **Use `cn()`** from `@/lib/core/utils/cn` for conditional classes
4. **Use `font-medium`** (not `font-normal`) as the base weight - it maps to theme-aware `--font-weight-medium`
5. **Use `rounded-sm`** (`4px`) for inputs and small elements, `rounded-[5px]` for buttons
6. **Use `text-caption`** (`12px`) as the default UI text size, `text-small` (`13px`) for labels
7. **Use `transition-colors`** for interactive hover/active states
8. **Respect `motion-reduce:animate-none`** on all animations
9. **Use `data-[disabled]`** for disabled states on Radix components, `disabled:` for native elements

### Token Usage Patterns

```tsx
// Surface hierarchy: bg < surface-1 < surface-2 < surface-3 < surface-4 < surface-5 < surface-6 < surface-7
// Text hierarchy: text-primary > text-secondary > text-tertiary > text-muted > text-subtle
// Border hierarchy: border < border-1 < border-muted

// Interactive element pattern
className="bg-[var(--surface-4)] text-[var(--text-secondary)] border-[var(--border)]
  hover-hover:bg-[var(--surface-6)] hover-hover:text-[var(--text-primary)] hover-hover:border-[var(--border-1)]"

// Input pattern
className="border-[var(--border-1)] bg-[var(--surface-5)] text-[var(--text-primary)]
  placeholder:text-[var(--text-muted)] focus-visible:border-[var(--text-muted)]"

// Disabled pattern
className="disabled:cursor-not-allowed disabled:opacity-50"
// or for Radix
className="data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
```
