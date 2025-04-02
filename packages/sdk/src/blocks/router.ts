import { Block } from './base'

export interface Route {
  id: string
  targetId: string
  description?: string
}

export interface RouterOptions {
  routes: Route[]
  defaultRouteId?: string
  routingExpression?: string
}

/**
 * Router block for dynamic path selection in workflows
 */
export class RouterBlock extends Block {
  constructor(options: RouterOptions) {
    super('router', options)
    this.metadata.id = 'router'
  }

  /**
   * Add a route
   */
  addRoute(route: Route): this {
    if (!this.data.routes) {
      this.data.routes = []
    }
    this.data.routes.push(route)
    return this
  }

  /**
   * Remove a route by ID
   */
  removeRoute(routeId: string): this {
    if (this.data.routes) {
      this.data.routes = this.data.routes.filter(
        (r: Route) => r.id !== routeId
      )
    }
    return this
  }

  /**
   * Set all routes at once
   */
  setRoutes(routes: Route[]): this {
    this.data.routes = routes
    return this
  }

  /**
   * Set the default route ID
   */
  setDefaultRoute(routeId: string): this {
    this.data.defaultRouteId = routeId
    return this
  }

  /**
   * Set the routing expression
   */
  setRoutingExpression(expression: string): this {
    this.data.routingExpression = expression
    return this
  }
} 