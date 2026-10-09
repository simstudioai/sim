import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application/operation'

/** permission-group-exempt: reports only the deployment-wide rollout switch; actions require chat authorization. */
const availabilityOperation = defineOperation({
  id: 'desktop.computer.availability',
  capability: 'none',
  principalKinds: ['session'],
})

/** The authenticated settings and capability read; no device or app data leaves the desktop. */
export const readComputerUseAvailability: OperationUseCase<
  typeof availabilityOperation,
  undefined,
  { enabled: boolean }
> = {
  operation: availabilityOperation,
  async execute({ principal }) {
    assertOperationPrincipal(principal, availabilityOperation)
    return { enabled: await isComputerUseAvailable() }
  },
}
