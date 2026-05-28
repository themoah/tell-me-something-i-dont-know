/**
 * Shared model-selection filters used by both update_models.ts (discovery)
 * and query_models.ts (querying). Single source of truth for the output-price
 * cap and slug-token detection so the two scripts can never drift apart.
 */

/** Skip any model whose output price exceeds this (USD per output token). */
export const MAX_OUTPUT_PRICE_PER_TOKEN = 30 / 1_000_000;

/**
 * True if the model's slug (the part after `provider/`) contains `token` as a
 * `-`-delimited word. Matches on token boundaries only, case-insensitive — so
 * `claude-fastlane` does NOT match `fast`.
 */
export function slugHasToken(id: string, token: string): boolean {
  const slashIdx = id.indexOf('/');
  const slug = slashIdx < 0 ? id : id.slice(slashIdx + 1);
  const want = token.toLowerCase();
  return slug.split('-').some((part) => part.toLowerCase() === want);
}

export const hasFastToken = (id: string): boolean => slugHasToken(id, 'fast');
export const hasLatestToken = (id: string): boolean => slugHasToken(id, 'latest');
