declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

/** The surface host mounts the public Platform stylesheet for the tree it wraps. */
declare module '*.css'
