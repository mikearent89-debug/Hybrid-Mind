import type { Entity, EntityAlias, EntityKind, Id } from './types';

/** Lower-cases, strips punctuation and collapses whitespace so "SunServ, LLC" and "sunserv llc" agree. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export type Resolution =
  | { match: 'exact'; entityId: Id; via: 'name' | 'alias' }
  | { match: 'fuzzy'; candidates: { entityId: Id; similarity: number; via: 'name' | 'alias' }[] }
  | { match: 'none' };

export interface ResolveOptions {
  kind?: EntityKind;
  /** String similarity (0..1) below which a name is not even a fuzzy candidate. */
  threshold?: number;
}

function tokens(s: string): Set<string> {
  return new Set(s.split(' ').filter(Boolean));
}

/** Jaccard overlap of word tokens: a plain string similarity, not a confidence about any fact. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(normalizeName(a));
  const tb = tokens(normalizeName(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Finds the entity a name refers to. An exact match on an entity name or a known alias resolves
 * without review; a fuzzy match is only a suggestion that a reviewer confirms as a new alias.
 */
export function resolveEntity(
  name: string,
  entities: Entity[],
  aliases: EntityAlias[],
  options: ResolveOptions = {},
): Resolution {
  const threshold = options.threshold ?? 0.5;
  const live = entities.filter(
    (e) =>
      e.reviewState !== 'superseded' && (options.kind === undefined || e.kind === options.kind),
  );
  const liveIds = new Set(live.map((e) => e.id));
  const target = normalizeName(name);

  const byName = live.find((e) => normalizeName(e.name) === target);
  if (byName) return { match: 'exact', entityId: byName.id, via: 'name' };
  const byAlias = aliases.find(
    (a) => a.origin !== 'proposed' && liveIds.has(a.entityId) && normalizeName(a.alias) === target,
  );
  if (byAlias) return { match: 'exact', entityId: byAlias.entityId, via: 'alias' };

  const scored = new Map<Id, { similarity: number; via: 'name' | 'alias' }>();
  const consider = (entityId: Id, text: string, via: 'name' | 'alias') => {
    const similarity = nameSimilarity(name, text);
    if (similarity < threshold) return;
    const best = scored.get(entityId);
    if (!best || similarity > best.similarity) scored.set(entityId, { similarity, via });
  };
  for (const e of live) consider(e.id, e.name, 'name');
  for (const a of aliases) if (liveIds.has(a.entityId)) consider(a.entityId, a.alias, 'alias');
  const candidates = [...scored]
    .map(([entityId, s]) => ({ entityId, ...s }))
    .sort((a, b) => b.similarity - a.similarity || a.entityId.localeCompare(b.entityId));
  return candidates.length > 0 ? { match: 'fuzzy', candidates } : { match: 'none' };
}
