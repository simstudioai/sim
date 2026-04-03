/** Shared className for primary auth/status CTA buttons on dark auth surfaces. */
export const AUTH_PRIMARY_CTA_BASE =
  'inline-flex h-[32px] items-center justify-center gap-2 rounded-[5px] border border-[var(--auth-primary-btn-border)] bg-[var(--auth-primary-btn-bg)] px-2.5 font-[430] font-season text-[var(--auth-primary-btn-text)] text-sm transition-colors hover:border-[var(--auth-primary-btn-hover-border)] hover:bg-[var(--auth-primary-btn-hover-bg)] hover:text-[var(--auth-primary-btn-hover-text)] disabled:cursor-not-allowed disabled:opacity-50' as const

/** Full-width variant used for primary auth form submit buttons. */
export const AUTH_SUBMIT_BTN = `${AUTH_PRIMARY_CTA_BASE} w-full` as const
