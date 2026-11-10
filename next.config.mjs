/** @type {import('next').NextConfig} */
const nextConfig = {
  // The contact upload goes through a server action, whose default 1 MB body
  // limit rejects a real voter file (District 23 is several MB).
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
