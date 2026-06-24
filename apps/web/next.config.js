/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/generate": ["./node_modules/ffmpeg-static/**/*"],
    },
  },
};

module.exports = nextConfig;
