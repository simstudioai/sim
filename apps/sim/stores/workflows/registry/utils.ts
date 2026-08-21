import { randomItem } from '@sim/utils/random'

const MACHINE_WORDS = [
  'amp',
  'app',
  'bit',
  'bot',
  'bus',
  'car',
  'cog',
  'cpu',
  'gpu',
  'jet',
  'mic',
  'pin',
  'van',
  'web',
  'zip',
  'auto',
  'bolt',
  'byte',
  'cart',
  'chip',
  'city',
  'code',
  'core',
  'data',
  'dial',
  'disk',
  'dock',
  'gate',
  'grid',
  'icon',
  'lens',
  'link',
  'lock',
  'node',
  'port',
  'ship',
  'sync',
  'tram',
  'volt',
  'watt',
  'wire',
  'audio',
  'cable',
  'cache',
  'clock',
  'drive',
  'laser',
  'logic',
  'metal',
  'meter',
  'modem',
  'motor',
  'mouse',
  'panel',
  'phone',
  'pixel',
  'radar',
  'radio',
  'relay',
  'servo',
  'synth',
  'tower',
  'wheel',
] as const

const NATURE_WORDS = [
  'air',
  'ant',
  'bee',
  'cat',
  'day',
  'dew',
  'elm',
  'fly',
  'hay',
  'ivy',
  'oak',
  'oat',
  'owl',
  'paw',
  'pet',
  'sea',
  'sky',
  'sun',
  'tea',
  'aloe',
  'bark',
  'dawn',
  'deer',
  'dove',
  'duck',
  'dune',
  'fawn',
  'fern',
  'hare',
  'iris',
  'lake',
  'leaf',
  'lily',
  'lion',
  'mint',
  'moss',
  'nest',
  'palm',
  'pear',
  'pine',
  'pond',
  'rain',
  'reed',
  'reef',
  'rose',
  'sand',
  'swan',
  'tide',
  'tree',
  'twig',
  'vine',
  'wave',
  'wind',
  'acorn',
  'apple',
  'beach',
  'birch',
  'bloom',
  'brook',
  'cedar',
  'cloud',
  'coral',
  'creek',
  'daisy',
  'eagle',
  'earth',
  'field',
  'grain',
  'grove',
  'koala',
  'lotus',
  'mango',
  'maple',
  'ocean',
  'olive',
  'pearl',
  'petal',
  'river',
  'robin',
  'shore',
  'tiger',
  'trail',
  'tulip',
  'water',
  'wheat',
  'woods',
] as const

const PREFERRED_NAME_LENGTHS = [7, 7, 7, 7, 7, 6, 6, 6, 6, 8, 8, 8, 9, 9, 10] as const

type WorkflowNameLength = (typeof PREFERRED_NAME_LENGTHS)[number]

function createWorkflowNamesByLength(): Record<WorkflowNameLength, string[]> {
  const namesByLength: Record<WorkflowNameLength, string[]> = {
    6: [],
    7: [],
    8: [],
    9: [],
    10: [],
  }

  for (const machine of MACHINE_WORDS) {
    for (const nature of NATURE_WORDS) {
      const length = machine.length + nature.length
      switch (length) {
        case 6:
        case 7:
        case 8:
        case 9:
        case 10:
          namesByLength[length].push(`${machine}-${nature}`)
          break
        default:
          throw new RangeError(`Workflow name words must total 6–10 letters, received ${length}`)
      }
    }
  }

  return namesByLength
}

const WORKFLOW_NAMES_BY_LENGTH = createWorkflowNamesByLength()

/**
 * Generates a short machine-nature workflow name, weighted toward seven letters.
 *
 * @returns A lowercase name such as `bolt-ivy` or `gpu-moss`.
 */
export function generateCreativeWorkflowName(): string {
  const length = randomItem(PREFERRED_NAME_LENGTHS)
  return randomItem(WORKFLOW_NAMES_BY_LENGTH[length])
}
