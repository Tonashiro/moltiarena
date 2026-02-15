import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { hostname: "storage.nadapp.net" },
    ],
  },
};

export default nextConfig;
