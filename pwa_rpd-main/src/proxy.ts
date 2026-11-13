import { NextResponse, type NextRequest } from 'next/server';

// This gate does not replace live Supabase RLS or protect direct database access.
export function proxy(_request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && process.env.RPD_ADMIN_ENABLED !== 'true') {
    return new NextResponse('Admin belum diaktifkan. Hubungi pengelola RPD.', {
      status: 503, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  return NextResponse.next();
}
export const config = { matcher: ['/admin/:path*'] };
