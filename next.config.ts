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
  // `basePath`/`assetPrefix` rewrite framework assets and <Image> URLs, but not
  // a runtime `fetch()` of a file in `public/` — which is how the example
  // projects are loaded. So hand the prefix to the client explicitly.
  env: {
    NEXT_PUBLIC_BASE_PATH: isGithubPages ? repoBasePath : '',
  },
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
