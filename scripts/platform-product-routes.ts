/**
 * Where the Platform's product routes live, relative to `apps/sim`, for the checks that govern them
 * (`check:platform-design`, `check:boundaries`, `check:platform-css`, `check:tool-registry-boundary`).
 * The main app serves them from their own route group, with the organization pages under
 * `o/[organizationId]/`.
 */
export const PRODUCT_ROUTES = 'app/(product)/'
/** The organization pages inside {@link PRODUCT_ROUTES}; workspace pages sit at its `workspace/`. */
export const ORGANIZATION_ROUTES = `${PRODUCT_ROUTES}o/[organizationId]/`
