/** Origin the wizard provisions Sim on locally, and the base for its env twins. */
export const APP_URL = 'http://localhost:3000'

/**
 * Where the wizard tells an operator to open Sim.
 *
 * A freshly provisioned deployment has no accounts yet and `/` renders the
 * marketing landing page, so handing over the bare origin leaves the operator
 * hunting for a CTA before they can create the first account. Deep-linking to
 * signup lands them on the one thing they can actually do.
 */
export const APP_SIGNUP_URL = `${APP_URL}/signup`
