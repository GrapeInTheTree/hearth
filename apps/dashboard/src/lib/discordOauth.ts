import type { OAuthGuild } from './auth-permissions';

// `auth.ts`'s session callback can't easily fetch the user's guilds — Discord
// requires a separate REST call with the access token. We make that call
// on demand from server components, with a short cache (60s) to dampen
// repeated dashboard navigations.
//
// Per Discord docs the endpoint is GET /users/@me/guilds; rate limit is
// shared across all calls for the same access token. A cold dashboard
// page load should incur ~1 call total per session.

interface RawGuild {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly permissions: string;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { fetchedAt: number; guilds: OAuthGuild[] }>();

export async function fetchUserGuilds(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<OAuthGuild[]> {
  const t = now();
  const cached = cache.get(accessToken);
  if (cached !== undefined && t - cached.fetchedAt < CACHE_MS) {
    return cached.guilds;
  }

  let response: Response;
  try {
    response = await fetchImpl('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Network error talking to Discord. If we have a cached value (even
    // expired), keep using it so the dashboard doesn't redirect-loop the
    // operator to /select-guild on a transient hiccup. The redirect-loop
    // matters because Next.js 15 caches the redirect-payload client-side;
    // once a /g/<guildId> request resolves to "redirect to /select-guild"
    // the router keeps serving that until a hard refresh. Returning stale
    // data here keeps the URL — and the cache — accurate.
    if (cached !== undefined) return cached.guilds;
    return [];
  }

  if (!response.ok) {
    // Same fallback policy as the network-error path above. Empty list is
    // the truthful signal that auth needs reconfiguring; stale cache is
    // the right choice when Discord is temporarily slow or rate-limiting.
    if (cached !== undefined) return cached.guilds;
    return [];
  }
  const raw = (await response.json()) as RawGuild[];
  const guilds: OAuthGuild[] = raw.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    permissions: g.permissions,
  }));
  cache.set(accessToken, { fetchedAt: t, guilds });
  return guilds;
}

/** Test helper. Resets the in-memory cache between tests. */
export function _resetGuildCache(): void {
  cache.clear();
}
