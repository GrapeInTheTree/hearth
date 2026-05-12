import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { checkBearer } from './auth.js';
import { sendError } from './json.js';
import { handleGuildResources, handleGuildsList } from './routes/guilds.js';
import { handleHealthz } from './routes/healthz.js';
import { handlePanelDelete, handlePanelRender, handlePanelRepost } from './routes/panels.js';
import {
  handleReactionRolesDelete,
  handleReactionRolesRender,
  handleReactionRolesRepost,
  handleReactionRolesRevokeHolders,
} from './routes/reaction-roles.js';
import { handleResolve } from './routes/resolve.js';
import {
  handleRolePickerDelete,
  handleRolePickerRender,
  handleRolePickerRepost,
  handleRolePickerRevokeHolders,
} from './routes/role-picker.js';
import {
  handleVerificationDelete,
  handleVerificationRender,
  handleVerificationRepost,
} from './routes/verifications.js';
import type { InternalApiContext } from './types.js';

export interface StartInternalApiOptions {
  readonly port: number;
  readonly token: string | undefined;
  readonly context: InternalApiContext;
}

// Single HTTP server hosting both the Docker readiness probe and the dashboard
// internal API. Deliberately small — no Express, no Fastify. The route table
// has under ten entries and the binding is localhost-only (the operator's
// nginx reverse-proxies the dashboard, not this port).

interface RouteMatch {
  readonly handle: () => Promise<void> | void;
  readonly requireAuth: boolean;
}

function matchRoute(
  ctx: InternalApiContext,
  req: IncomingMessage,
  res: ServerResponse,
): RouteMatch | null {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://internal');
  const { pathname } = url;

  // ── public ──
  if (method === 'GET' && pathname === '/healthz') {
    return {
      requireAuth: false,
      handle: () => {
        handleHealthz(ctx, res);
      },
    };
  }

  // ── /internal/* (auth required) ──
  if (method === 'GET' && pathname === '/internal/guilds/list') {
    return {
      requireAuth: true,
      handle: () => {
        handleGuildsList(ctx, url, res);
      },
    };
  }
  const resourceMatch = /^\/internal\/guilds\/(\d{17,20})\/resources$/.exec(pathname);
  if (method === 'GET' && resourceMatch !== null) {
    const [, guildId] = resourceMatch;
    if (guildId === undefined) return null;
    return {
      requireAuth: true,
      handle: () => {
        handleGuildResources(ctx, guildId, res);
      },
    };
  }
  const renderMatch = /^\/internal\/panels\/([^/]+)\/render$/.exec(pathname);
  if (method === 'POST' && renderMatch !== null) {
    const [, panelId] = renderMatch;
    if (panelId === undefined) return null;
    return { requireAuth: true, handle: async () => handlePanelRender(ctx, panelId, res) };
  }
  const repostMatch = /^\/internal\/panels\/([^/]+)\/repost$/.exec(pathname);
  if (method === 'POST' && repostMatch !== null) {
    const [, panelId] = repostMatch;
    if (panelId === undefined) return null;
    return { requireAuth: true, handle: async () => handlePanelRepost(ctx, panelId, res) };
  }
  const deleteMatch = /^\/internal\/panels\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && deleteMatch !== null) {
    const [, panelId] = deleteMatch;
    if (panelId === undefined) return null;
    return { requireAuth: true, handle: async () => handlePanelDelete(ctx, panelId, res) };
  }
  if (method === 'POST' && pathname === '/internal/resolve') {
    return { requireAuth: true, handle: async () => handleResolve(ctx, req, res) };
  }

  // ── verification (DEFI-658) ──
  const verificationRenderMatch = /^\/internal\/verifications\/([^/]+)\/render$/.exec(pathname);
  if (method === 'POST' && verificationRenderMatch !== null) {
    const [, panelId] = verificationRenderMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleVerificationRender(ctx, panelId, res),
    };
  }
  const verificationRepostMatch = /^\/internal\/verifications\/([^/]+)\/repost$/.exec(pathname);
  if (method === 'POST' && verificationRepostMatch !== null) {
    const [, panelId] = verificationRepostMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleVerificationRepost(ctx, panelId, res),
    };
  }
  const verificationDeleteMatch = /^\/internal\/verifications\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && verificationDeleteMatch !== null) {
    const [, panelId] = verificationDeleteMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleVerificationDelete(ctx, panelId, res),
    };
  }

  // ── reaction-roles (DEFI-661) ──
  const reactionRolesRenderMatch = /^\/internal\/reaction-roles\/([^/]+)\/render$/.exec(pathname);
  if (method === 'POST' && reactionRolesRenderMatch !== null) {
    const [, panelId] = reactionRolesRenderMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleReactionRolesRender(ctx, panelId, res),
    };
  }
  const reactionRolesRepostMatch = /^\/internal\/reaction-roles\/([^/]+)\/repost$/.exec(pathname);
  if (method === 'POST' && reactionRolesRepostMatch !== null) {
    const [, panelId] = reactionRolesRepostMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleReactionRolesRepost(ctx, panelId, res),
    };
  }
  const reactionRolesDeleteMatch = /^\/internal\/reaction-roles\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && reactionRolesDeleteMatch !== null) {
    const [, panelId] = reactionRolesDeleteMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleReactionRolesDelete(ctx, panelId, res),
    };
  }
  const reactionRolesRevokeHoldersMatch =
    /^\/internal\/reaction-roles\/([^/]+)\/options\/([^/]+)\/revoke-holders$/.exec(pathname);
  if (method === 'POST' && reactionRolesRevokeHoldersMatch !== null) {
    const [, panelId, optionId] = reactionRolesRevokeHoldersMatch;
    if (panelId === undefined || optionId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleReactionRolesRevokeHolders(ctx, panelId, optionId, res),
    };
  }

  // ── role-picker (StringSelectMenu) ──
  const rolePickerRenderMatch = /^\/internal\/role-picker\/([^/]+)\/render$/.exec(pathname);
  if (method === 'POST' && rolePickerRenderMatch !== null) {
    const [, panelId] = rolePickerRenderMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleRolePickerRender(ctx, panelId, res),
    };
  }
  const rolePickerRepostMatch = /^\/internal\/role-picker\/([^/]+)\/repost$/.exec(pathname);
  if (method === 'POST' && rolePickerRepostMatch !== null) {
    const [, panelId] = rolePickerRepostMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleRolePickerRepost(ctx, panelId, res),
    };
  }
  const rolePickerDeleteMatch = /^\/internal\/role-picker\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && rolePickerDeleteMatch !== null) {
    const [, panelId] = rolePickerDeleteMatch;
    if (panelId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleRolePickerDelete(ctx, panelId, res),
    };
  }
  const rolePickerRevokeHoldersMatch =
    /^\/internal\/role-picker\/([^/]+)\/options\/([^/]+)\/revoke-holders$/.exec(pathname);
  if (method === 'POST' && rolePickerRevokeHoldersMatch !== null) {
    const [, panelId, optionId] = rolePickerRevokeHoldersMatch;
    if (panelId === undefined || optionId === undefined) return null;
    return {
      requireAuth: true,
      handle: async () => handleRolePickerRevokeHolders(ctx, panelId, optionId, res),
    };
  }

  return null;
}

export function startInternalApi({
  port,
  token,
  context,
}: StartInternalApiOptions): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const matched = matchRoute(context, req, res);
          if (matched === null) {
            sendError(res, 'not_found', `${req.method ?? 'GET'} ${req.url ?? '/'} not found`);
            return;
          }
          if (matched.requireAuth) {
            const auth = checkBearer(req, token);
            if (auth === 'misconfigured') {
              sendError(
                res,
                'discord_unavailable',
                'INTERNAL_API_TOKEN is not configured on the bot',
              );
              return;
            }
            if (auth === 'unauthorized') {
              sendError(res, 'unauthorized', 'invalid or missing bearer token');
              return;
            }
          }
          await matched.handle();
        } catch (err) {
          // Log the underlying error via stderr so ops can correlate. Don't
          // leak details to the client (return only a generic message).

          console.error('[internal-api] handler error:', err);
          if (!res.headersSent) {
            sendError(res, 'internal', 'internal server error');
          }
        }
      })();
    });

    server.once('error', reject);
    server.listen(port, () => {
      // Sapphire logger isn't wired through container yet at this point
      // in bootstrap; matches the existing healthcheck pattern.

      console.log(`[internal-api] listening on :${port}`);
      resolve(server);
    });
  });
}
