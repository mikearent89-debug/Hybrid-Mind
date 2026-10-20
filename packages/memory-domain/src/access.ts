import type { AnchorLink, Id, MemoryDataset, Principal } from './types';

/**
 * Memory as one principal may see it. Restricted records, and every record that hangs off them,
 * are removed. Search, retrieval, exports, and assistant context must read through this (AC-17).
 */
export function visibleMemory(dataset: MemoryDataset, principal: Principal): MemoryDataset {
  if (principal.canSeeRestricted) return dataset;
  const standard = <T extends { accessScope: string }>(rows: T[]) =>
    rows.filter((r) => r.accessScope !== 'restricted');
  const ids = <T extends { id: Id }>(rows: T[]) => new Set(rows.map((r) => r.id));

  const sources = standard(dataset.sources);
  const sourceIds = ids(sources);
  const revisions = standard(dataset.revisions).filter((r) => sourceIds.has(r.sourceId));
  const revisionIds = ids(revisions);
  const anchors = standard(dataset.anchors).filter((a) => revisionIds.has(a.revisionId));
  const anchorIds = ids(anchors);
  const anchorsVisible = (links: AnchorLink[]) => links.every((l) => anchorIds.has(l.anchorId));

  const entities = standard(dataset.entities);
  const entityIds = ids(entities);
  const aliases = standard(dataset.aliases).filter((a) => entityIds.has(a.entityId));
  const episodes = standard(dataset.episodes).map((e) => ({
    ...e,
    revisionIds: e.revisionIds.filter((id) => revisionIds.has(id)),
  }));

  const claims = standard(dataset.claims).filter(
    (c) =>
      entityIds.has(c.subjectId) &&
      (c.object.type !== 'entity' || entityIds.has(c.object.entityId)) &&
      anchorsVisible(c.anchors),
  );
  const claimIds = ids(claims);

  const cases = standard(dataset.cases).filter(
    (c) =>
      c.context.entityIds.every((id) => entityIds.has(id)) &&
      c.claimIds.every((id) => claimIds.has(id)) &&
      anchorsVisible(c.anchors),
  );
  const caseIds = ids(cases);

  const lessons = standard(dataset.lessons).map((l) => ({
    ...l,
    supportingCaseIds: l.supportingCaseIds.filter((id) => caseIds.has(id)),
    counterEvidenceCaseIds: l.counterEvidenceCaseIds.filter((id) => caseIds.has(id)),
  }));
  const lessonIds = ids(lessons);

  const proposals = standard(dataset.proposals).filter(
    (p) =>
      caseIds.has(p.caseId) &&
      p.assessment.similarCaseIds.every((id) => caseIds.has(id)) &&
      (p.draft === null || anchorsVisible(p.draft.anchors)),
  );
  const proposalIds = ids(proposals);

  const outcomes = standard(dataset.outcomes)
    .filter((o) => proposalIds.has(o.proposalId) && anchorsVisible(o.anchors))
    .map((o) => ({ ...o, lessonIds: o.lessonIds.filter((id) => lessonIds.has(id)) }));

  const visibleIds = new Set<Id>([
    ...sourceIds,
    ...revisionIds,
    ...anchorIds,
    ...entityIds,
    ...ids(aliases),
    ...ids(episodes),
    ...claimIds,
    ...caseIds,
    ...lessonIds,
    ...proposalIds,
    ...ids(outcomes),
  ]);
  const candidates = standard(dataset.candidates).filter(
    (c) =>
      (c.targetId === null || visibleIds.has(c.targetId)) &&
      (c.mergeSourceId === null || visibleIds.has(c.mergeSourceId)),
  );

  return {
    label: dataset.label,
    sources,
    revisions,
    anchors,
    episodes,
    entities,
    aliases,
    claims,
    cases,
    lessons,
    candidates,
    proposals,
    outcomes,
  };
}
