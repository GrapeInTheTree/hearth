// Re-export the shared Result type so server actions can use it without
// reaching into the package directly. Convenience only; same module.
export { err, fromPromise, isErr, isOk, ok, type Result } from '@hearth/shared';

export {
  ConflictError,
  DiscordApiError,
  InternalError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from '@hearth/shared';
