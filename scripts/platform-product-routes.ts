/**
 * Where the Platform's product routes live, relative to `apps/sim`, for the checks that govern them
 * (`check:platform-design`, `check:boundaries`). The route tree moves into the main app as
 * `app/(product)/`, with the organization pages under `o/[organizationId]/`; these two constants are
 * the whole of that move as far as the checks are concerned.
 */
export const PRODUCT_ROUTES = 'platform/app/(shell)/'
/** The organization pages inside {@link PRODUCT_ROUTES}; workspace pages sit at its `workspace/`. */
export const ORGANIZATION_ROUTES = PRODUCT_ROUTES
