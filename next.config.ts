import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Redirect bare domain to www
      {
        source: "/:path*",
        has: [{ type: "host", value: "prismo.us" }],
        destination: "https://www.prismo.us/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
