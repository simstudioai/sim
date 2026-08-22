'use client'

import { SettingsSectionSkeleton } from '@/components/settings/settings-section-skeleton'

/**
 * The `next/dynamic` options every code-split settings section is loaded with.
 *
 * Settings is a long tail of surfaces where any one visit opens exactly one of them, so
 * bundling them all would charge every visitor for the whole tail. The `loading` fallback is
 * what keeps that split invisible: it is the same placeholder the route's `loading.tsx`
 * renders, so a section whose chunk was not warmed by a sidebar hover still transitions
 * skeleton → content instead of blanking in between.
 *
 * Every plane's renderer passes this, so the wait looks identical whether a section is
 * reached inside a workspace, an account, an organization, or a self-hosted deployment.
 *
 * Shared as options rather than as a `dynamic()` wrapper on purpose — a wrapper has to
 * re-infer each section's props through its own generic, and loses them.
 */
export const SETTINGS_SECTION_LOADING_OPTIONS = {
  loading: () => <SettingsSectionSkeleton />,
}
