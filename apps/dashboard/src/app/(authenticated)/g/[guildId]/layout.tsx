import { notFound, redirect } from 'next/navigation';

import { Sidebar } from '@/components/layout/sidebar';
import { branding } from '@/config/branding';
import { auth } from '@/lib/auth';
import { hasManageGuild } from '@/lib/auth-permissions';
import { fetchUserGuilds } from '@/lib/discordOauth';

interface GuildLayoutProps {
  readonly children: React.ReactNode;
  readonly params: Promise<{ readonly guildId: string }>;
}

/**
 * Per-guild authorization gate. Verifies the user holds Manage Guild on
 * the URL's guildId before rendering any of the nested pages. Reading
 * Discord's `/users/@me/guilds` is cached 60s by `fetchUserGuilds`, so
 * navigation across pages doesn't pay this cost on every render.
 *
 * On unauthorized:
 *  - User isn't signed in            → /login (redirect)
 *  - User isn't in the guild         → /select-guild (redirect)
 *  - User lacks Manage Guild         → 403 page (rendered via notFound;
 *                                      we map it to a 403 in the
 *                                      not-found UI, not a 404, so the
 *                                      operator sees the right message)
 */
export default async function GuildLayout({
  children,
  params,
}: GuildLayoutProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId } = await params;
  const guilds =
    session.discordAccessToken !== '' ? await fetchUserGuilds(session.discordAccessToken) : [];
  const guild = guilds.find((g) => g.id === guildId);
  if (guild === undefined) {
    redirect('/select-guild');
  }
  if (!hasManageGuild(guild.permissions)) {
    notFound();
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar guildId={guildId} brandName={branding.name} brandIconUrl={branding.iconUrl} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
