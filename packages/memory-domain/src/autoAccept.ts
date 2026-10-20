import { conflictingClaims } from './store';
import type { Claim, Entity, Id, MemoryDataset } from './types';

export const AUTO_ACCEPT_RULE = 'auto-accept/v1';

export interface AutoAcceptVerdict {
  accepted: boolean;
  rule: typeof AUTO_ACCEPT_RULE;
  /** Why the claim did not qualify; empty when it did. */
  reasons: string[];
}

function resolvedByExternalId(entity: Entity | undefined): boolean {
  return entity !== undefined && entity.externalRefs.length > 0;
}

/**
 * The narrow rule under which a claim is accepted without a human review (MEMORY-SPEC section 7):
 * documented, one supporting anchor into an immutable revision, every entity resolved by external
 * ID rather than by a fuzzy alias, and nothing in memory that conflicts with it. Everything else
 * waits for a reviewer. The acceptance is still an event and remains reversible.
 */
export function autoAcceptable(claim: Claim, dataset: MemoryDataset): AutoAcceptVerdict {
  const reasons: string[] = [];
  if (claim.reviewState !== 'unreviewed') reasons.push(`review state is ${claim.reviewState}`);
  if (claim.evidenceClass !== 'documented') {
    reasons.push(`evidence class is ${claim.evidenceClass}, not documented`);
  }
  if (claim.anchors.length !== 1) {
    reasons.push(`${claim.anchors.length} anchors; exactly one supporting anchor is required`);
  } else {
    const link = claim.anchors[0]!;
    if (link.role !== 'supporting') reasons.push(`anchor role is ${link.role}, not supporting`);
    const anchor = dataset.anchors.find((a) => a.id === link.anchorId);
    const revision = anchor && dataset.revisions.find((r) => r.id === anchor.revisionId);
    if (!anchor) reasons.push('anchor does not exist');
    else if (!revision) reasons.push('anchor does not point at a stored revision');
  }
  const byId = (id: Id) => dataset.entities.find((e) => e.id === id);
  if (!resolvedByExternalId(byId(claim.subjectId))) {
    reasons.push('subject entity is not resolved by external ID');
  }
  if (claim.object.type === 'entity' && !resolvedByExternalId(byId(claim.object.entityId))) {
    reasons.push('object entity is not resolved by external ID');
  }
  const conflicts = conflictingClaims(claim, dataset.claims);
  if (conflicts.length > 0) {
    reasons.push(`conflicts with ${conflicts.map((c) => c.id).join(', ')}`);
  }
  return { accepted: reasons.length === 0, rule: AUTO_ACCEPT_RULE, reasons };
}
