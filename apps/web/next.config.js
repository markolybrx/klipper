/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/generate": [
        "./node_modules/@ffmpeg-installer/**/*",
        "./node_modules/fluent-ffmpeg/**/*",
      ],
    },
  },
};

module.exports = nextConfig;
