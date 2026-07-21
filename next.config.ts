import type {NextConfig} from 'next';

// When building for GitHub Pages the app is served from a project subpath
// (https://<user>.github.io/trixelart/), so it needs a static export and a
// basePath. Locally / on other hosts these stay unset and it serves at root.
const isGithubPages = process.env.GITHUB_PAGES === 'true';
const repoBasePath = '/trixelart';

const nextConfig: NextConfig = {
  ...(isGithubPages
    ? { output: 'export', basePath: repoBasePath, assetPrefix: `${repoBasePath}/` }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
