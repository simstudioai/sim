'use client'

import { Chip, ChipChevronDown } from '@/components/emcn'

/**
 * Navbar dropdown trigger — a bare `Chip` with the canonical chip chevron
 * (the same 10×6 glyph the sidebar workspace header uses).
 *
 * Client leaf so the icon component can be passed as a prop and so the
 * hover-dropdown behavior can attach here without making the whole
 * navbar a client component.
 */

interface NavMenuChipProps {
  label: string
}

export function NavMenuChip({ label }: NavMenuChipProps) {
  return <Chip rightIcon={ChipChevronDown}>{label}</Chip>
}
