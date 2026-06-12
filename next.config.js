const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Externe URLs nie cachen – verhindert SW-Blockierung von Graph/Drive
  runtimeCaching: [
    {
      // App-Shell: Next.js Seiten
      urlPattern: /^https:\/\/[^/]+\/_next\//,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "next-static" },
    },
    {
      // Icons + public assets
      urlPattern: /^https:\/\/[^/]+\/(?:icons|favicon)\//,
      handler: "CacheFirst",
      options: { cacheName: "static-assets", expiration: { maxEntries: 50 } },
    },
    // ALLES andere (graph.microsoft.com, googleapis.com, login.microsoft...) → NetworkOnly
    // = kein SW-Intercept, direkt ans Netz
    {
      urlPattern: /^https:\/\/(graph\.microsoft\.com|login\.microsoftonline\.com|www\.googleapis\.com|lh3\.googleusercontent\.com)/,
      handler: "NetworkOnly",
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    domains: [
      "lh3.googleusercontent.com",
      "graph.microsoft.com",
    ],
  },
};

module.exports = withPWA(nextConfig);
