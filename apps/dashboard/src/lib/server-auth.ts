import { type Result, err, ok } from '@discord-bot/shared';
import { PermissionError } from '@discord-bot/shared';
import { redirect } from 'next/navigation';

import { auth } from './auth';
import { hasManageGuild } from './auth-permissions';
import { fetchUserGuilds } from './discordOauth';

/**
 * Server Action / RSC guard. Verifies the user is signed in, in the
 * target guild, and holds Manage Guild. Returns Result so callers can
 * map the failure into a `Result<T, AppError>` response.
 *
 * `redirect()` is for navigation cases (RSC pages); Server Actions
 * should branch on the Result so the form's banner surfaces the
 * permission error rather than a hard navigation.
 */
export async function authorizeGuild(
  guildId: string,
): Promise<Result<{ userId: string; username: string }, PermissionError>> {
  const session = await auth();
  if (session === null) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/g/${guildId}`)}`);
  }
  const accessToken = session.discordAccessToken;
  if (accessToken === '') {
    return err(new PermissionError('Discord session is missing the access token; sign in again'));
  }
  const guilds = await fetchUserGuilds(accessToken);
  const guild = guilds.find((g) => g.id === guildId);
  if (guild === undefined) {
    return err(new PermissionError(`You are not a member of guild ${guildId}`));
  }
  if (!hasManageGuild(guild.permissions)) {
    return err(new PermissionError('Manage Guild permission required'));
  }
  return ok({ userId: session.user.discordId, username: session.user.username });
}
