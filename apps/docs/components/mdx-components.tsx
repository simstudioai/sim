import defaultMdxComponents from 'fumadocs-ui/mdx'
import { ThemeImage } from './ui/theme-image'

// Extend the default MDX components with our custom components
const mdxComponents = {
  ...defaultMdxComponents,
  ThemeImage
}

export default mdxComponents 