import { prepareConsentStorage } from '@/lib/consent/storage'

/** Expire saved choices synchronously before hydration can initialize tracking providers. */
prepareConsentStorage()
