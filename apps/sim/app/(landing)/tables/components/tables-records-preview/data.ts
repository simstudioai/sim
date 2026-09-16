export interface LeadRecord {
  id: string
  company: string
  score: number
  status: 'Qualified' | 'Review'
  contact: string
}

export const ROWS: readonly LeadRecord[] = [
  {
    id: 'acme',
    company: 'Acme Corp',
    score: 94,
    status: 'Qualified',
    contact: 'Alice Johnson',
  },
  {
    id: 'northstar',
    company: 'Northstar',
    score: 88,
    status: 'Qualified',
    contact: 'Daniel Park',
  },
  {
    id: 'meridian',
    company: 'Meridian',
    score: 72,
    status: 'Review',
    contact: 'Eva Chen',
  },
  {
    id: 'forma',
    company: 'Forma',
    score: 91,
    status: 'Qualified',
    contact: 'Sam Rivera',
  },
  {
    id: 'brightwave',
    company: 'Brightwave',
    score: 86,
    status: 'Qualified',
    contact: 'Morgan Lee',
  },
  {
    id: 'atlas',
    company: 'Atlas',
    score: 79,
    status: 'Review',
    contact: 'Alex Chen',
  },
]
