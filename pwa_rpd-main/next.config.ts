import type { NextConfig } from "next";
// These are the image origins used by the current public pages and CMS.
const imageHosts = new Set([
  'radioppidunia.org',
  'www.radioppidunia.org',
  'images.unsplash.com',
  'slelguoygbfzlpylpxfs.supabase.co',
]);

if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const storageUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (storageUrl.protocol !== 'https:' || !storageUrl.hostname.endsWith('.supabase.co')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be an HTTPS Supabase project URL');
  }
  imageHosts.add(storageUrl.hostname);
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [...imageHosts].map((hostname) => ({ protocol: 'https' as const, hostname })),
  },
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
      ],
    }];
  },
};

export default nextConfig;
