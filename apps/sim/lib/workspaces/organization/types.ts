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
