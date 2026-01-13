/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing from src/ directory
  transpilePackages: [],

  // Disable strict mode for easier migration (can enable later)
  reactStrictMode: false,

  // Configure for standalone output (better for Docker)
  output: 'standalone',

  // Ignore TypeScript errors during build for gradual migration
  typescript: {
    // Will be removed once migration is complete
    ignoreBuildErrors: false,
  },

  // Environment variables that should be available on the client
  env: {
    // Add any public env vars here
  },

  // Turbopack configuration (Next.js 16 default bundler)
  turbopack: {
    // Turbopack handles browser polyfills automatically
  },
};

module.exports = nextConfig;
