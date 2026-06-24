/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/generate": ["./node_modules/ffmpeg-static/**/*"],
  },
};

module.exports = nextConfig;
