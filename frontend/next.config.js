/** @type {import('next').NextConfig} */
// Next.js 14 reads its config as plain JavaScript (TypeScript config files arrive in Next 15).
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    // the web app imports the TypeScript SDK that lives next to it in the repository (../sdk)
    experimental: { externalDir: true },
};

module.exports = nextConfig;
