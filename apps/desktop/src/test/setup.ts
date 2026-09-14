import { vi } from 'vitest'

/** Existing behavior tests stub prompt responses at the shared dialog boundary. */
vi.mock('@/main/dialogs', () => import('@/test/dialog-mock'))
