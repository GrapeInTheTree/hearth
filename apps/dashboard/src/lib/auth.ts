import NextAuth, { type NextAuthConfig } from 'next-auth';
import Discord from 'next-auth/providers/discord';

import { env } from './env';

// Auth.js v5 (next-auth@beta) Discord provider. JWT session strategy —
// no DB session table, the user's identity + guild list ride in the JWT
// (which is signed with NEXTAUTH_SECRET). Session is read from a cookie
// on every request, so no per-request database round-trip.
//
// Scopes: `identify` + `guilds`. `identify` gives us user id/username/
// avatar; `guilds` gives the user's guild list with their permissions
// bitfield in each entry — that's how we authorize Manage Guild
// without ever needing the bot token.

// Auth.js defaults `useSecureCookies` to true whenever NODE_ENV=production,
// which forces `__Secure-` cookie name prefixes. Browsers refuse those over
// http://, so a production-built dashboard served over plain HTTP (e.g. local
// docker run, or any reverse-proxy setup that terminates TLS upstream and
// forwards http) drops the PKCE verifier cookie → callback fails with
// "InvalidCheck: pkceCodeVerifier value could not be parsed". Tying secure
// cookies to the actual URL scheme keeps both production (https) and local
// docker (http) working without env-flag babysitting.
const useSecureCookies = env.NEXTAUTH_URL.startsWith('https://');

const config: NextAuthConfig = {
  trustHost: true,
  useSecureCookies,
  secret: env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    Discord({
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      authorization: { params: { scope: 'identify guilds' } },
    }),
  ],
  callbacks: {
    jwt({ token, account, profile }) {
      // First sign-in: capture access token from `account` and identifying
      // profile fields. Subsequent calls (refresh) reuse the same token.
      if (account === null || account === undefined) return token;
      const profileObj = (profile ?? {}) as Record<string, unknown>;
      const next = { ...token };
      const profileId = profileObj.id;
      if (typeof profileId === 'string') next.discordId = profileId;
      const profileUsername = profileObj.username;
      if (typeof profileUsername === 'string') next.username = profileUsername;
      const profileAvatar = profileObj.avatar;
      next.avatarHash = typeof profileAvatar === 'string' ? profileAvatar : null;
      if (typeof account.access_token === 'string') {
        next.discordAccessToken = account.access_token;
      }
      // expires_at on the account is in seconds; cache for the dashboard
      // refresh path (Phase 2.x — for now a stale guild list just shows
      // last-known state until next sign-in).
      next.discordExpiresAt = typeof account.expires_at === 'number' ? account.expires_at : 0;
      return next;
    },
    session({ session, token }) {
      // Project the JWT claims onto the session shape consumed by RSC pages.
      return {
        ...session,
        user: {
          ...session.user,
          discordId: typeof token.discordId === 'string' ? token.discordId : '',
          username: typeof token.username === 'string' ? token.username : '',
          avatarHash: typeof token.avatarHash === 'string' ? token.avatarHash : null,
        },
        discordAccessToken:
          typeof token.discordAccessToken === 'string' ? token.discordAccessToken : '',
      };
    },
  },
  pages: {
    signIn: '/login',
  },
};

// next-auth v5 (beta) leaks internal type imports through its inferred
// return types. Re-export each entry point with an explicit type
// annotation (against the public NextAuthResult shape) so tsc doesn't
// flag non-portable type references when this module is consumed across
// the workspace.
const nextAuth = NextAuth(config);
export const auth: ReturnType<typeof NextAuth>['auth'] = nextAuth.auth;
export const handlers: ReturnType<typeof NextAuth>['handlers'] = nextAuth.handlers;
export const signIn: ReturnType<typeof NextAuth>['signIn'] = nextAuth.signIn;
export const signOut: ReturnType<typeof NextAuth>['signOut'] = nextAuth.signOut;

// Augment the next-auth ambient types so RSC code can read these fields
// off the session without `any` casts.
declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      discordId: string;
      username: string;
      avatarHash: string | null;
    };
    discordAccessToken: string;
  }
}

declare module 'next-auth' {
  interface JWT {
    discordId?: string;
    username?: string;
    avatarHash?: string | null;
    discordAccessToken?: string;
    discordExpiresAt?: number;
  }
}
