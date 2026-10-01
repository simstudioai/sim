interface User {
  name?: string
  email?: string
  id?: string
  image?: string | null
}

export interface Member {
  id: string
  role: string
  user?: User
}

interface Invitation {
  id: string
  email: string
  status: string
  membershipIntent?: 'internal' | 'external'
}

export interface Organization {
  id: string
  name: string
  slug: string
  logo?: string | null
  members?: Member[]
  invitations?: Invitation[]
  createdAt: string | Date
  [key: string]: unknown
}
