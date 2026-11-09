import type { ReactNode } from 'react'

type RouteParams = Record<string, string | string[] | undefined>

/** A product page's props: its route's dynamic segments and the query, as Next passes them. */
export interface ProductPageProps<Params extends RouteParams> {
  params: Promise<Params>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** A product layout's props: its route's dynamic segments and the page beneath it. */
export interface ProductLayoutProps<Params extends RouteParams> {
  params: Promise<Params>
  children: ReactNode
}
