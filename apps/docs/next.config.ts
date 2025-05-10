import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  devServer: {
    port: 3001,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/introduction",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
