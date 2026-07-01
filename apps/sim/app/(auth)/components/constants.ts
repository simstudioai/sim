/**
 * Auth and invite surfaces use a slightly taller control than the 30px chip
 * default, matching the landing `HeroCta` field family (the landing's own
 * auth-adjacent CTA renders taller fields than in-app chips). Applied as the
 * single source of truth for every auth field and button height so the inputs,
 * submit, social, SSO, and invite action buttons stay on one line.
 */
export const AUTH_CONTROL_HEIGHT = 'h-9'

/**
 * Shared layout for full-width auth/invite chip buttons (submit, social, SSO,
 * invite actions). `[&>span]:flex-none` collapses the chip's stretching label
 * span — which carries `flex-1` — so the icon + label cluster truly centers
 * under `justify-center` (the landing `HeroCta` idiom). Height-only inputs use
 * {@link AUTH_CONTROL_HEIGHT}; buttons compose this on top of it.
 */
export const AUTH_BUTTON_CLASS = `${AUTH_CONTROL_HEIGHT} w-full justify-center [&>span]:flex-none`
