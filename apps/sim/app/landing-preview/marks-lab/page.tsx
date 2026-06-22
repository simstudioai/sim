import { MarksLab } from '@/app/landing-preview/marks-lab/marks-lab'

/**
 * Internal brand-mark tuning lab. Not linked from nav — reachable at
 * /landing-preview/marks-lab for dialing in mark parameters before porting the
 * values into the production component constants.
 */
export default function MarksLabPage() {
  return <MarksLab />
}
