# Nano Stores

<img align="right" width="92" height="92" title="Nano Stores logo"
     src="https://nanostores.github.io/nanostores/logo.svg">

A tiny state manager for **React**, **React Native**, **Preact**, **Vue**,
**Svelte**, **Solid**, **Lit**, **Angular**, and vanilla JS.
It uses **many atomic stores** and direct manipulation.

* **Small.** Between 265 and 803 bytes (minified and brotlied).
  Zero dependencies. It uses [Size Limit] to control size.
* **Fast.** With small atomic and derived stores, you do not need to call
  the selector function for all components on every store change.
* **Tree Shakable.** A chunk contains only stores used by components
  in the chunk.
* Designed to move logic from components to stores.
* Good **TypeScript** support.

```ts
// store/users.ts
import { atom } from 'nanostores'

export const $users = atom<User[]>([])

export function addUser(user: User) {
  $users.set([...$users.get(), user]);
}
```

```ts
// store/admins.ts
import { computed } from 'nanostores'
import { $users } from './users.js'

export const $admins = computed($users, users => users.filter(i => i.isAdmin))
```

```tsx
// components/admins.tsx
import { useStore } from '@nanostores/react'
import { $admins } from '../stores/admins.js'

export const Admins = () => {
  const admins = useStore($admins)
  return (
    <ul>
      {admins.map(user => <UserItem user={user} />)}
    </ul>
  )
}
```

---

<img src="https://cdn.evilmartians.com/badges/logo-no-label.svg" alt="" width="22" height="16" />  Made at <b><a href="https://evilmartians.com/devtools?utm_source=nanostores&utm_campaign=devtools-button&utm_medium=github">Evil Martians</a></b>, product consulting for <b>developer tools</b>.

---

[Size Limit]: https://github.com/ai/size-limit


## Docs
Read full docs **[here](https://github.com/nanostores/nanostores#readme)**.
