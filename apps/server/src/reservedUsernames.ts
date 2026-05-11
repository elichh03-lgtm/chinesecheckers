export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'root',
  'system',
  'support',
  'null',
  'undefined',
  'anonymous',
  'halma',
  'server',
  'mod',
  'moderator',
  'bot',
]);

export function isReservedUsername(name: string): boolean {
  return RESERVED_USERNAMES.has(name.trim().toLowerCase());
}
