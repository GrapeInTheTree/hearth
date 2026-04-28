import { type NextRequest, NextResponse } from 'next/server';

// Edge-compatible middleware. Does NOT import lib/auth.ts — that pulls
// the @hearth/database chain (Prisma's driver adapter uses node:path)
// which the Edge runtime can't bundle. Instead, we check for the presence
// of the NextAuth session cookie as a coarse signal, and the (authenticated)
// layout does the real session validation server-side.

const SESSION_COOKIE_NAMES = [
  'authjs.session-token', // dev (HTTP)
  '__Secure-authjs.session-token', // prod (HTTPS)
];

export default function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Public paths
  if (
    pathname === '/login' ||
    pathname === '/' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', req.nextUrl);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Run on every page request except next/image and static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon).*)'],
};
