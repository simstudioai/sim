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

export interface Organization {
  id: string
  name: string
  slug: string
  logo?: string | null
  members?: Member[]
  createdAt: string | Date
  [key: string]: unknown
}
