import { AUTO_ACCEPT_RULE } from './autoAccept';
import { EMPTY_LOG, appendEvent, projectMemory, type EventLog, type MemoryEvent } from './store';
import type {
  Anchor,
  AnchorLink,
  Candidate,
  Case,
  Claim,
  Entity,
  EntityAlias,
  EntityKind,
  Episode,
  Id,
  Instant,
  Lesson,
  MemoryDataset,
  Outcome,
  Principal,
  Proposal,
  RecordBase,
  RecordByType,
  RecordType,
  Revision,
  Source,
} from './types';

// SYNTHETIC FIXTURE. Every site, vendor, person, device, document and case below is invented for
// design and testing (MEMORY-SPEC section 10). It is not operational data and must be labeled as
// such wherever it is shown. Real portfolio material only ever enters the owner's own deployment.

export const FIXTURE_LABEL = 'Sunbelt Solar Portfolio memory (synthetic)';

/** The fixture's fixed "now", so staleness and as-of queries are reproducible. */
export const FIXTURE_AS_OF: Instant = '2026-10-20T15:00:00Z';

export const AVERY: Id = 'u-avery';
export const JORDAN: Id = 'u-jordan';

export const PRINCIPALS: Principal[] = [
  { id: AVERY, name: 'Avery Moss', canSeeRestricted: true },
  { id: JORDAN, name: 'Jordan Reyes', canSeeRestricted: false },
];

const T = (day: number, hour = 15) =>
  `2026-${day <= 30 ? '09' : '10'}-${String(day <= 30 ? day : day - 30).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;

const base = (id: Id, extra: Partial<RecordBase> = {}): RecordBase => ({
  id,
  recordVersion: 1,
  accessScope: 'standard',
  evidenceClass: 'documented',
  reviewState: 'accepted',
  reviewedBy: AVERY,
  reviewedAt: T(1),
  effectiveFrom: null,
  effectiveTo: null,
  ...extra,
});

// ---- Entities -------------------------------------------------------------------------------

const SITE_MESA = 'site-mesa-ridge';
const SITE_HIGH = 'site-high-plains';
const SITE_RIVER = 'site-river-bend';
const SITE_COAST = 'site-coastal-flats';
const ORG_INTERNAL = 'org-internal';
const ORG_SOLARIS = 'org-solaris';
const ORG_GRIDLINE = 'org-gridline';
const ORG_GRIDLINE_DUP = 'org-gridline-llc';
const ORG_DESERT = 'org-desert';
const MODEL_HELION = 'model-helion-x200';
const MODEL_VANTAGE = 'model-vantage-c1500';
const FW_HELION_314 = 'fw-helion-3.1.4';
const FW_HELION_320 = 'fw-helion-3.2.0';
const FW_VANTAGE_702 = 'fw-vantage-7.0.2';
const FW_VANTAGE_710 = 'fw-vantage-7.1.0';
const INV_MR_03 = 'eq-inv-mr-03';
const INV_HP_02 = 'eq-inv-hp-02';
const INV_RB_01 = 'eq-inv-rb-01';
const INV_RB_04 = 'eq-inv-rb-04';
const INV_CF_01 = 'eq-inv-cf-01';
const INV_MR_07 = 'eq-inv-mr-07';
const REGION_DESERT = 'region-southwest-desert';
const REGION_GULF = 'region-gulf-coast';
const COND_HIGH_AMBIENT = 'cond-ambient-over-40c';
const CONTRACT_SOLARIS = 'contract-solaris-om-2025';
const PERSON_MORGAN = 'person-morgan-hale';

function entity(
  id: Id,
  kind: EntityKind,
  name: string,
  attributes: Record<string, string> = {},
  workbenchId: string | null = id,
  extra: Partial<RecordBase> = {},
): Entity {
  return {
    ...base(id, extra),
    kind,
    name,
    attributes,
    externalRefs: workbenchId ? [{ sourceSystem: 'workbench', externalId: workbenchId }] : [],
  };
}

const ENTITIES: Entity[] = [
  entity(SITE_MESA, 'site', 'Mesa Ridge', { timezone: 'America/Phoenix', region: REGION_DESERT }),
  entity(SITE_HIGH, 'site', 'High Plains', { timezone: 'America/Denver', region: REGION_DESERT }),
  entity(SITE_RIVER, 'site', 'River Bend', { timezone: 'America/Chicago', region: REGION_GULF }),
  entity(SITE_COAST, 'site', 'Coastal Flats', { timezone: 'America/Chicago', region: REGION_GULF }),
  entity(ORG_INTERNAL, 'organization', 'Asset Management (internal)', { type: 'internal' }),
  entity(ORG_SOLARIS, 'organization', 'Solaris O&M', { type: 'vendor' }),
  entity(ORG_GRIDLINE, 'organization', 'Gridline Services', { type: 'vendor' }),
  // Duplicate created by an email import before the alias existed; merged below (FX-M10).
  entity(ORG_GRIDLINE_DUP, 'organization', 'Gridline Services LLC', { type: 'vendor' }, null, {
    evidenceClass: 'inferred',
    reviewState: 'unreviewed',
    reviewedBy: null,
    reviewedAt: null,
  }),
  entity(ORG_DESERT, 'organization', 'Desert Field Co.', { type: 'vendor' }),
  entity(MODEL_HELION, 'equipment-model', 'Helion X200 string inverter', {
    manufacturer: 'Helion (synthetic)',
    ratedKw: '200',
  }),
  entity(MODEL_VANTAGE, 'equipment-model', 'Vantage C1500 central inverter', {
    manufacturer: 'Vantage (synthetic)',
    ratedKw: '1500',
  }),
  entity(FW_HELION_314, 'firmware', 'Helion X200 firmware 3.1.4', { model: MODEL_HELION }),
  entity(FW_HELION_320, 'firmware', 'Helion X200 firmware 3.2.0', { model: MODEL_HELION }),
  entity(FW_VANTAGE_702, 'firmware', 'Vantage C1500 firmware 7.0.2', { model: MODEL_VANTAGE }),
  entity(FW_VANTAGE_710, 'firmware', 'Vantage C1500 firmware 7.1.0', { model: MODEL_VANTAGE }),
  entity(INV_MR_03, 'equipment-unit', 'INV-MR-03', { site: SITE_MESA, model: MODEL_HELION }),
  entity(INV_MR_07, 'equipment-unit', 'INV-MR-07', { site: SITE_MESA, model: MODEL_VANTAGE }),
  entity(INV_HP_02, 'equipment-unit', 'INV-HP-02', { site: SITE_HIGH, model: MODEL_HELION }),
  entity(INV_RB_01, 'equipment-unit', 'INV-RB-01', { site: SITE_RIVER, model: MODEL_HELION }),
  entity(INV_RB_04, 'equipment-unit', 'INV-RB-04', { site: SITE_RIVER, model: MODEL_VANTAGE }),
  entity(INV_CF_01, 'equipment-unit', 'INV-CF-01', { site: SITE_COAST, model: MODEL_VANTAGE }),
  entity(REGION_DESERT, 'region', 'Southwest desert', {}, null),
  entity(REGION_GULF, 'region', 'Gulf coast', {}, null),
  entity(COND_HIGH_AMBIENT, 'operating-condition', 'Ambient above 40 °C', {}, null),
  entity(CONTRACT_SOLARIS, 'contract', 'Solaris O&M services agreement 2025', {
    vendor: ORG_SOLARIS,
  }),
  entity(PERSON_MORGAN, 'person', 'Morgan Hale', { organization: ORG_SOLARIS }),
];

const alias = (id: Id, entityId: Id, text: string, origin: EntityAlias['origin'] = 'seed') => ({
  ...base(id),
  entityId,
  alias: text,
  origin,
});

const ALIASES: EntityAlias[] = [
  alias('alias-solaris-1', ORG_SOLARIS, 'Solaris'),
  alias('alias-solaris-2', ORG_SOLARIS, 'SunServ'),
  alias('alias-gridline-1', ORG_GRIDLINE, 'Gridline'),
  alias('alias-desert-1', ORG_DESERT, 'DFC'),
  alias('alias-mesa-1', SITE_MESA, 'Mesa Ridge Solar'),
  alias('alias-mesa-2', SITE_MESA, 'MRS'),
  alias('alias-high-1', SITE_HIGH, 'HP1'),
  alias('alias-helion-1', MODEL_HELION, 'X200'),
];

// ---- Sources, revisions, anchors ----------------------------------------------------------------

interface Doc {
  source: Source;
  revision: Revision;
  anchor: Anchor;
}

function doc(
  n: number,
  kind: Source['kind'],
  title: string,
  siteIds: Id[],
  received: Instant,
  locator: Anchor['locator'] = { type: 'whole' },
  extra: Partial<RecordBase> = {},
): Doc {
  const id = String(n).padStart(2, '0');
  const sourceId = `src-${id}`;
  const revisionId = `rev-${id}`;
  return {
    source: {
      ...base(sourceId, extra),
      kind,
      title,
      originSystem: kind === 'email' ? 'mailbox:om-inbox (synthetic)' : 'manual-upload',
      externalId: kind === 'work-order' ? `WO-${1000 + n}` : null,
      siteIds,
    },
    revision: {
      ...base(revisionId, extra),
      sourceId,
      contentHash: `sha256:${id.repeat(32)}`,
      mediaType: kind === 'photo' ? 'image/jpeg' : kind === 'csv' ? 'text/csv' : 'application/pdf',
      byteLength: 10_000 + n * 137,
      receivedAt: received,
      supersedesRevisionId: null,
    },
    anchor: { ...base(`anc-${id}`, extra), revisionId, locator },
  };
}

const DOCS: Doc[] = [
  doc(1, 'work-order', 'WO-1001 Mesa Ridge INV-MR-03 DC fuse replacement', [SITE_MESA], T(2), {
    type: 'page',
    page: 1,
  }),
  doc(
    2,
    'work-order',
    'WO-1002 Mesa Ridge INV-MR-03 firmware upgrade to 3.2.0',
    [SITE_MESA],
    T(9),
    {
      type: 'page',
      page: 2,
    },
  ),
  doc(3, 'email', 'RE: High Plains INV-HP-02 still tripping', [SITE_HIGH], T(11), {
    type: 'span',
    start: 220,
    end: 290,
    quote: 'the unit is on 3.1.4, same as before the visit',
  }),
  doc(4, 'work-order', 'WO-1004 High Plains INV-HP-02 firmware upgrade', [SITE_HIGH], T(10), {
    type: 'row',
    row: 7,
    column: 'firmware_after',
  }),
  doc(
    5,
    'report',
    'Coastal Flats warranty claim review (confidential)',
    [SITE_COAST],
    T(12),
    {
      type: 'page',
      page: 3,
    },
    { accessScope: 'restricted' },
  ),
  doc(6, 'csv', 'River Bend monthly inverter export September 2026', [SITE_RIVER], T(31), {
    type: 'row',
    row: 1,
    column: 'firmware',
  }),
  doc(7, 'email', 'Fw: Rodent damage suspected at River Bend combiner 4', [SITE_RIVER], T(14), {
    type: 'span',
    start: 40,
    end: 120,
    quote: 'tech thinks it is rodents again but did not open the box',
  }),
  doc(8, 'report', 'High Plains derate investigation, Helion X200 fleet', [SITE_HIGH], T(16), {
    type: 'page',
    page: 4,
  }),
  doc(9, 'report', 'River Bend derate investigation, Helion X200 fleet', [SITE_RIVER], T(18), {
    type: 'page',
    page: 2,
  }),
  doc(
    10,
    'work-order',
    'WO-1010 Mesa Ridge INV-MR-07 firmware upgrade to 7.1.0',
    [SITE_MESA],
    T(20),
    {
      type: 'page',
      page: 1,
    },
  ),
  doc(11, 'photo', 'River Bend combiner 4 after inspection', [SITE_RIVER], T(21), {
    type: 'image-region',
    x: 120,
    y: 80,
    w: 400,
    h: 300,
  }),
  doc(12, 'note', 'Vendor call notes, 2026-10-05', [SITE_HIGH, SITE_RIVER], T(35)),
  doc(
    13,
    'report',
    'Proposal outcome: River Bend INV-RB-01 cooling retrofit',
    [SITE_RIVER],
    T(40),
    {
      type: 'page',
      page: 1,
    },
  ),
  doc(14, 'email', 'Gridline Services LLC invoice query', [SITE_COAST], T(22)),
];

const anchorOf = (n: number): Id => `anc-${String(n).padStart(2, '0')}`;
const revisionOf = (n: number): Id => `rev-${String(n).padStart(2, '0')}`;
const supporting = (n: number): AnchorLink => ({ anchorId: anchorOf(n), role: 'supporting' });

// ---- Episodes -------------------------------------------------------------------------------

const EPISODES: Episode[] = [
  {
    ...base('ep-seed'),
    startedAt: T(1),
    actorId: AVERY,
    method: { name: 'seed', version: '1' },
    correlationId: 'seed-1',
    revisionIds: [],
  },
  {
    ...base('ep-intake-1'),
    startedAt: T(23),
    actorId: AVERY,
    method: { name: 'intake-extract', version: '0.1' },
    correlationId: 'intake-1',
    revisionIds: DOCS.filter((d) => d.source.accessScope === 'standard').map((d) => d.revision.id),
  },
  {
    ...base('ep-intake-restricted', { accessScope: 'restricted' }),
    startedAt: T(24),
    actorId: AVERY,
    method: { name: 'intake-extract', version: '0.1' },
    correlationId: 'intake-2',
    revisionIds: [revisionOf(5)],
  },
];

// ---- Claims -----------------------------------------------------------------------------------

function claim(
  id: Id,
  subjectId: Id,
  relation: string,
  object: Claim['object'],
  anchors: AnchorLink[],
  extra: Partial<RecordBase> = {},
  episodeId: Id = 'ep-intake-1',
): Claim {
  return {
    ...base(id, extra),
    subjectId,
    relation,
    object,
    anchors,
    episodeId,
    supersedesClaimId: null,
    invalidatedAt: null,
  };
}

const entityObj = (entityId: Id): Claim['object'] => ({ type: 'entity', entityId });
const valueObj = (value: string, unit: string | null = null): Claim['object'] => ({
  type: 'value',
  value,
  unit,
});

const CLAIMS: Claim[] = [
  // FX-M07: superseded when INV-MR-03 was upgraded (invalidated below, superseded by cl-02).
  claim('cl-01', INV_MR_03, 'runs-firmware', entityObj(FW_HELION_314), [supporting(1)], {
    effectiveFrom: T(1),
  }),
  claim('cl-02', INV_MR_03, 'runs-firmware', entityObj(FW_HELION_320), [supporting(2)], {
    effectiveFrom: T(9),
  }),
  claim(
    'cl-03',
    INV_MR_03,
    'had-fault',
    valueObj('nuisance DC overcurrent trip'),
    [supporting(1)],
    {
      effectiveFrom: T(1),
      effectiveTo: T(9),
    },
  ),
  // FX-M02: two documents disagree on INV-HP-02's firmware over the same window.
  claim('cl-04', INV_HP_02, 'runs-firmware', entityObj(FW_HELION_320), [supporting(4)], {
    effectiveFrom: T(10),
  }),
  claim('cl-05', INV_HP_02, 'runs-firmware', entityObj(FW_HELION_314), [supporting(3)], {
    effectiveFrom: T(10),
    reviewState: 'unreviewed',
    reviewedBy: null,
    reviewedAt: null,
  }),
  // FX-M04: qualifies for auto-accept (documented, one anchor, entities by external ID, no conflict).
  claim('cl-06', INV_RB_01, 'runs-firmware', entityObj(FW_HELION_320), [supporting(6)], {
    effectiveFrom: T(31),
    reviewState: 'unreviewed',
    reviewedBy: null,
    reviewedAt: null,
  }),
  // FX-M05: inferred, so it waits for a reviewer however good the anchor is.
  claim(
    'cl-07',
    INV_RB_04,
    'had-fault-cause',
    valueObj('rodent damage to combiner wiring'),
    [supporting(7)],
    {
      evidenceClass: 'inferred',
      reviewState: 'unreviewed',
      reviewedBy: null,
      reviewedAt: null,
      effectiveFrom: T(14),
    },
  ),
  claim('cl-08', SITE_HIGH, 'operates-under', entityObj(COND_HIGH_AMBIENT), [supporting(8)], {
    effectiveFrom: '2026-06-01T00:00:00Z',
    effectiveTo: '2026-09-30T00:00:00Z',
  }),
  claim('cl-09', SITE_RIVER, 'operates-under', entityObj(COND_HIGH_AMBIENT), [supporting(9)], {
    effectiveFrom: '2026-06-01T00:00:00Z',
    effectiveTo: '2026-09-30T00:00:00Z',
  }),
  claim('cl-10', INV_MR_07, 'runs-firmware', entityObj(FW_VANTAGE_710), [supporting(10)], {
    effectiveFrom: T(20),
  }),
  claim(
    'cl-11',
    INV_CF_01,
    'runs-firmware',
    entityObj(FW_VANTAGE_702),
    [supporting(5)],
    {
      accessScope: 'restricted',
      effectiveFrom: T(12),
    },
    'ep-intake-restricted',
  ),
  claim('cl-12', SITE_MESA, 'serviced-by', entityObj(ORG_SOLARIS), [supporting(1)], {
    effectiveFrom: '2025-01-01T00:00:00Z',
  }),
  claim('cl-13', SITE_COAST, 'serviced-by', entityObj(ORG_GRIDLINE_DUP), [supporting(14)], {
    evidenceClass: 'inferred',
    reviewState: 'unreviewed',
    reviewedBy: null,
    reviewedAt: null,
  }),
];

// ---- Cases ------------------------------------------------------------------------------------

function memoryCase(
  id: Id,
  title: string,
  symptom: string,
  entityIds: Id[],
  conditions: string[],
  fields: Partial<Case> = {},
  extra: Partial<RecordBase> = {},
): Case {
  return {
    ...base(id, extra),
    title,
    symptom,
    context: { entityIds, conditions },
    investigation: { hypotheses: [], diagnosticActions: [], unresolvedQuestions: [] },
    actionsTried: [],
    fix: null,
    cost: null,
    downtimeHours: null,
    outcome: null,
    limitations: [],
    ownerId: AVERY,
    claimIds: [],
    anchors: [],
    openedAt: T(1),
    closedAt: null,
    ...fields,
  };
}

const HELION_DERATE = 'Helion X200 derates to 60 % output on afternoons above 40 °C';

const CASES: Case[] = [
  // FX-M01: the first action failed; the second fixed it.
  memoryCase(
    'case-01',
    'Mesa Ridge INV-MR-03 nuisance DC overcurrent trips',
    'INV-MR-03 trips on DC overcurrent two to four times per afternoon with no measured overcurrent',
    [SITE_MESA, INV_MR_03, MODEL_HELION, FW_HELION_314, ORG_SOLARIS],
    ['Helion X200', 'firmware 3.1.4', 'ambient above 40 °C'],
    {
      investigation: {
        hypotheses: ['DC fuse fatigue', 'firmware 3.1.4 overcurrent threshold bug'],
        diagnosticActions: ['fuse resistance check', 'event log export', 'vendor bulletin review'],
        unresolvedQuestions: [],
      },
      actionsTried: [
        {
          description: 'Replaced all DC string fuses (WO-1001)',
          result: 'failed',
          occurredAt: T(2),
          claimIds: ['cl-03'],
        },
        {
          description: 'Upgraded firmware 3.1.4 → 3.2.0 (WO-1002)',
          result: 'succeeded',
          occurredAt: T(9),
          claimIds: ['cl-02'],
        },
      ],
      fix: 'Firmware 3.2.0 raised the DC overcurrent debounce; trips stopped the same day',
      cost: { amount: 1850, currency: 'USD' },
      downtimeHours: 14,
      outcome: 'No trips in the 30 days after the upgrade',
      limitations: [
        'Only one unit; fuses were replaced first, so their effect cannot be separated',
      ],
      claimIds: ['cl-01', 'cl-02', 'cl-03'],
      anchors: [supporting(1), supporting(2)],
      closedAt: T(12),
    },
  ),
  // FX-M02: the case that carries the firmware conflict on INV-HP-02.
  memoryCase(
    'case-02',
    'High Plains INV-HP-02 keeps tripping after firmware visit',
    'INV-HP-02 trips continued after WO-1004; the email and the work order disagree on firmware',
    [SITE_HIGH, INV_HP_02, MODEL_HELION, ORG_SOLARIS],
    ['Helion X200', 'firmware disputed', 'ambient above 40 °C'],
    {
      investigation: {
        hypotheses: ['upgrade was not applied', 'upgrade applied but trips have another cause'],
        diagnosticActions: ['request firmware screenshot from site'],
        unresolvedQuestions: ['Which firmware is INV-HP-02 actually running?'],
      },
      claimIds: ['cl-04', 'cl-05'],
      anchors: [supporting(3), supporting(4)],
      limitations: ['Conflicting sources; nothing concluded until the firmware is confirmed'],
    },
    { reviewState: 'unreviewed', reviewedBy: null, reviewedAt: null },
  ),
  // FX-M03: restricted; only a principal with restricted access can see it or anything on it.
  memoryCase(
    'case-03',
    'Coastal Flats INV-CF-01 warranty dispute',
    'Vantage C1500 IGBT failure within warranty; vendor disputes coverage',
    [SITE_COAST, INV_CF_01, MODEL_VANTAGE, FW_VANTAGE_702, ORG_GRIDLINE],
    ['Vantage C1500', 'firmware 7.0.2', 'warranty'],
    { claimIds: ['cl-11'], anchors: [supporting(5)] },
    { accessScope: 'restricted' },
  ),
  // FX-M06: sibling cases, same model, firmware and symptom at two sites.
  memoryCase(
    'case-04',
    'High Plains Helion X200 afternoon derate',
    HELION_DERATE,
    [SITE_HIGH, MODEL_HELION, FW_HELION_314, COND_HIGH_AMBIENT, ORG_SOLARIS],
    ['Helion X200', 'firmware 3.1.4', 'ambient above 40 °C', 'Southwest desert'],
    {
      actionsTried: [
        {
          description: 'Upgraded fleet firmware to 3.2.0',
          result: 'succeeded',
          occurredAt: T(17),
          claimIds: [],
        },
      ],
      fix: 'Firmware 3.2.0 changed the thermal derate curve',
      outcome: 'Afternoon derate reduced from 40 % to 8 %',
      claimIds: ['cl-08'],
      anchors: [supporting(8)],
      closedAt: T(19),
    },
  ),
  memoryCase(
    'case-05',
    'River Bend Helion X200 afternoon derate',
    HELION_DERATE,
    [SITE_RIVER, INV_RB_01, MODEL_HELION, FW_HELION_314, COND_HIGH_AMBIENT, ORG_GRIDLINE],
    ['Helion X200', 'firmware 3.1.4', 'ambient above 40 °C', 'Gulf coast'],
    {
      investigation: {
        hypotheses: ['same thermal derate as High Plains', 'blocked enclosure filters'],
        diagnosticActions: ['filter inspection', 'compare curves with High Plains'],
        unresolvedQuestions: ['Does humidity change the result?'],
      },
      claimIds: ['cl-06', 'cl-09'],
      anchors: [supporting(9)],
    },
  ),
  // FX-M05 lives here: an inferred cause that must be reviewed.
  memoryCase(
    'case-06',
    'River Bend combiner 4 ground fault',
    'Recurring ground fault on INV-RB-04 string 4',
    [SITE_RIVER, INV_RB_04, MODEL_VANTAGE, ORG_GRIDLINE],
    ['Vantage C1500', 'combiner', 'rodents suspected'],
    {
      investigation: {
        hypotheses: ['rodent damage', 'water ingress'],
        diagnosticActions: ['open combiner 4 and photograph wiring'],
        unresolvedQuestions: ['Was the box opened?'],
      },
      claimIds: ['cl-07'],
      anchors: [supporting(7), supporting(11)],
    },
  ),
  // FX-M08 counter-evidence: the same upgrade idea did not help on another model.
  memoryCase(
    'case-07',
    'Mesa Ridge INV-MR-07 afternoon derate (Vantage)',
    'Vantage C1500 derates on hot afternoons',
    [SITE_MESA, INV_MR_07, MODEL_VANTAGE, FW_VANTAGE_710, COND_HIGH_AMBIENT, ORG_SOLARIS],
    ['Vantage C1500', 'firmware 7.1.0', 'ambient above 40 °C'],
    {
      actionsTried: [
        {
          description: 'Upgraded firmware 7.0.2 → 7.1.0 (WO-1010)',
          result: 'failed',
          occurredAt: T(20),
          claimIds: ['cl-10'],
        },
      ],
      outcome: 'Derate unchanged; cooling fan replacement planned',
      claimIds: ['cl-10'],
      anchors: [supporting(10)],
    },
  ),
  memoryCase(
    'case-08',
    'River Bend INV-RB-01 cooling retrofit',
    'Follow-up to case-05: enclosure cooling as the second lever',
    [SITE_RIVER, INV_RB_01, MODEL_HELION, ORG_GRIDLINE],
    ['Helion X200', 'cooling'],
    { anchors: [supporting(13)] },
  ),
  memoryCase(
    'case-09',
    'High Plains tracker communication dropouts',
    'Tracker controllers lose communication after storms',
    [SITE_HIGH, ORG_SOLARIS],
    ['trackers', 'storm'],
  ),
  memoryCase(
    'case-10',
    'Coastal Flats vegetation shading row 12',
    'Row 12 string currents 20 % below neighbors in the morning',
    [SITE_COAST, ORG_GRIDLINE],
    ['vegetation', 'shading'],
  ),
  memoryCase(
    'case-11',
    'Mesa Ridge meter drift',
    'Revenue meter reads 1.2 % below inverter sum',
    [SITE_MESA, ORG_DESERT],
    ['metering'],
  ),
  memoryCase(
    'case-12',
    'River Bend vendor response time',
    'Gridline response to P2 work exceeds the contract target',
    [SITE_RIVER, ORG_GRIDLINE],
    ['contract', 'response time'],
    { anchors: [supporting(12)] },
  ),
];

// ---- Lessons, candidates, proposals, outcomes ----------------------------------------------

const LESSONS: Lesson[] = [
  // FX-M08: supported by case-01 and case-04, contradicted on the Vantage model by case-07.
  {
    ...base('lesson-01'),
    statement:
      'On Helion X200 units running 3.1.4 in ambient above 40 °C, upgrading to 3.2.0 removes afternoon derates and nuisance trips',
    conditions: ['Helion X200', 'firmware 3.1.4', 'ambient above 40 °C'],
    action: 'Upgrade firmware to 3.2.0',
    expectedOutcome: 'Derate and trips stop within a day',
    supportingCaseIds: ['case-01', 'case-04'],
    counterEvidenceCaseIds: ['case-07'],
    status: 'reviewed',
    ownerId: AVERY,
  },
  {
    ...base('lesson-02', {
      evidenceClass: 'proposed',
      reviewState: 'unreviewed',
      reviewedBy: null,
      reviewedAt: null,
    }),
    statement: 'Combiner ground faults near tree lines are usually rodent damage',
    conditions: ['combiner', 'tree line within 20 m'],
    action: 'Open the box and photograph before replacing fuses',
    expectedOutcome: 'Visible insulation damage',
    supportingCaseIds: ['case-06'],
    counterEvidenceCaseIds: [],
    status: 'candidate',
    ownerId: JORDAN,
  },
];

const CANDIDATES: Candidate[] = [
  // FX-M11: a merge the reviewer has not decided yet.
  {
    ...base('cand-01', {
      evidenceClass: 'inferred',
      reviewState: 'unreviewed',
      reviewedBy: null,
      reviewedAt: null,
    }),
    operation: 'merge',
    targetType: 'entity',
    targetId: SITE_MESA,
    mergeSourceId: null,
    payload: { alias: 'Mesa Ridge Solar Park' },
    method: { name: 'entity-resolution', version: '0.1' },
    uncertainty: {
      level: 'medium',
      reasons: 'Name differs from the known alias "Mesa Ridge Solar" by one word',
    },
    episodeId: 'ep-intake-1',
    decision: null,
  },
  // Decided below: the inferred rodent claim is accepted after the technician's photo.
  {
    ...base('cand-02', {
      evidenceClass: 'inferred',
      reviewState: 'unreviewed',
      reviewedBy: null,
      reviewedAt: null,
    }),
    operation: 'add',
    targetType: 'claim',
    targetId: null,
    mergeSourceId: null,
    payload: { claimId: 'cl-07' },
    method: { name: 'intake-extract', version: '0.1' },
    uncertainty: { level: 'low', reasons: 'Technician did not open the box; cause is a guess' },
    episodeId: 'ep-intake-1',
    decision: null,
  },
];

// FX-M09: a proposal that went through both gates and has a recorded outcome.
const PROPOSALS: Proposal[] = [
  {
    ...base('prop-01', { reviewState: 'unreviewed', reviewedBy: null, reviewedAt: null }),
    caseId: 'case-05',
    stage: 'assessment',
    assessment: {
      similarCaseIds: ['case-04', 'case-01'],
      keyDifferences: [
        'Gulf coast humidity',
        'single unit, not fleet',
        'vendor is Gridline, not Solaris',
      ],
      evidenceGaps: ['no filter inspection record'],
      nextSteps: ['upgrade INV-RB-01 to 3.2.0', 'inspect enclosure filters'],
      causeConfidence: {
        level: 'high',
        reasons: 'Same model, firmware, symptom and temperature band as case-04',
      },
      nextStepConfidence: {
        level: 'medium',
        reasons: 'Humidity is not covered by the High Plains result',
      },
    },
    draft: null,
    publishedAt: null,
    workbenchLogPosition: null,
  },
  {
    ...base('prop-02', { reviewState: 'unreviewed', reviewedBy: null, reviewedAt: null }),
    caseId: 'case-02',
    stage: 'assessment',
    assessment: {
      similarCaseIds: ['case-01'],
      keyDifferences: ['firmware not confirmed'],
      evidenceGaps: ['firmware screenshot'],
      nextSteps: ['confirm firmware before any further action'],
      causeConfidence: {
        level: 'low',
        reasons: 'Sources conflict on the one fact the diagnosis depends on',
      },
      nextStepConfidence: { level: 'high', reasons: 'A screenshot settles it' },
    },
    draft: null,
    publishedAt: null,
    workbenchLogPosition: null,
  },
];

const PROP_01_DRAFT: Proposal = {
  ...PROPOSALS[0]!,
  stage: 'review-2',
  draft: {
    scope: 'Upgrade INV-RB-01 to firmware 3.2.0 and inspect enclosure filters on the same visit',
    ownerIds: [PERSON_MORGAN, AVERY],
    targetDates: [{ label: 'site visit', date: '2026-10-08' }],
    dependencies: ['Gridline schedules a technician', 'firmware package from Helion'],
    costBasis: [
      {
        description: 'Technician day rate per contract',
        amount: 950,
        currency: 'USD',
        anchorId: anchorOf(12),
      },
    ],
    successCriteria: ['Afternoon derate below 10 % for 14 days'],
    anchors: [supporting(9), supporting(12)],
  },
};

const OUTCOMES: Outcome[] = [
  {
    ...base('out-01'),
    proposalId: 'prop-01',
    description: 'Upgrade applied 2026-10-08; derate fell to 6 % over the following 14 days',
    result: 'succeeded',
    lessonIds: ['lesson-01'],
    recordedBy: AVERY,
    occurredAt: T(38),
    anchors: [supporting(13)],
  },
];

// ---- The log ---------------------------------------------------------------------------------

type Step = { at: Instant; actor?: Id; correlationId?: string; event: MemoryEvent };

const added = <K extends RecordType>(
  recordType: K,
  records: RecordByType[K][],
  at: Instant,
  correlationId: string,
): Step[] =>
  records.map((record) => ({
    at,
    correlationId,
    event: { type: 'record-added', recordType, record } as Extract<
      MemoryEvent,
      { type: 'record-added'; recordType: K }
    >,
  }));

const STEPS: Step[] = [
  ...added('entity', ENTITIES, T(1), 'seed-1'),
  ...added('entity-alias', ALIASES, T(1), 'seed-1'),
  ...added(
    'source',
    DOCS.map((d) => d.source),
    T(23),
    'intake-1',
  ),
  ...added(
    'revision',
    DOCS.map((d) => d.revision),
    T(23),
    'intake-1',
  ),
  ...added(
    'anchor',
    DOCS.map((d) => d.anchor),
    T(23),
    'intake-1',
  ),
  ...added('episode', EPISODES, T(23), 'intake-1'),
  ...added('claim', CLAIMS, T(23), 'intake-1'),
  ...added('case', CASES, T(25), 'intake-1'),
  ...added('lesson', LESSONS, T(26), 'review-1'),
  ...added('candidate', CANDIDATES, T(23), 'intake-1'),
  ...added('proposal', PROPOSALS, T(27), 'review-1'),
  // FX-M04: the rule accepts cl-06.
  {
    at: T(23, 16),
    actor: 'system:auto-accept',
    correlationId: 'intake-1',
    event: { type: 'claim-auto-accepted', claimId: 'cl-06', rule: AUTO_ACCEPT_RULE },
  },
  // FX-M07: the 3.1.4 claim on INV-MR-03 ends when the upgrade is documented.
  {
    at: T(25),
    correlationId: 'review-1',
    event: {
      type: 'claim-invalidated',
      claimId: 'cl-01',
      invalidatedAt: T(9),
      reason: 'Superseded by WO-1002 firmware upgrade',
      supersededByClaimId: 'cl-02',
    },
  },
  // FX-M10: the duplicate vendor record is folded into Gridline Services.
  {
    at: T(26),
    correlationId: 'review-1',
    event: {
      type: 'entities-merged',
      survivorId: ORG_GRIDLINE,
      mergedId: ORG_GRIDLINE_DUP,
      reason: 'Same vendor; "LLC" suffix from an invoice email',
    },
  },
  {
    at: T(26),
    correlationId: 'review-1',
    event: {
      type: 'candidate-decided',
      candidateId: 'cand-02',
      decision: 'accepted',
      reason: 'Photo in rev-11 shows chewed insulation',
      resultingId: 'cl-07',
    },
  },
  // FX-M09: prop-01 through both gates, published, outcome recorded.
  {
    at: T(28),
    correlationId: 'review-1',
    event: {
      type: 'review-recorded',
      proposalId: 'prop-01',
      gate: 1,
      decision: 'approve',
      notes: 'Direction agreed; include the filter inspection',
    },
  },
  {
    at: T(29),
    correlationId: 'review-2',
    event: {
      type: 'record-superseded',
      recordType: 'proposal',
      record: { ...PROP_01_DRAFT, recordVersion: 2 },
      basedOnVersion: 1,
      reason: 'Draft prepared after review 1',
    },
  },
  {
    at: T(30),
    correlationId: 'review-2',
    event: {
      type: 'review-recorded',
      proposalId: 'prop-01',
      gate: 2,
      decision: 'approve',
      notes: 'Approved as drafted',
    },
  },
  {
    at: T(30, 16),
    correlationId: 'review-2',
    event: {
      type: 'proposal-published',
      proposalId: 'prop-01',
      publishedAt: T(30, 16),
      workbenchLogPosition: null,
    },
  },
  ...added('outcome', OUTCOMES, T(40), 'outcome-1'),
  {
    at: T(40),
    correlationId: 'outcome-1',
    event: {
      type: 'lesson-status-changed',
      lessonId: 'lesson-01',
      status: 'qualified',
      reason: 'Holds on Helion X200 only; case-07 shows it does not transfer to Vantage C1500',
    },
  },
];

export const FIXTURE_LOG: EventLog = STEPS.reduce(
  (log, step) =>
    appendEvent(log, step.event, step.actor ?? AVERY, step.at, {
      correlationId: step.correlationId,
    }),
  EMPTY_LOG,
);

export const FIXTURE: MemoryDataset = projectMemory(FIXTURE_LOG, { label: FIXTURE_LABEL });

/** Named fixture cases (MEMORY-SPEC section 10) so tests and traceability can reference them. */
export const FIXTURE_CASES = {
  'FX-M01': { title: 'Failed fix then successful fix', ids: ['case-01'] },
  'FX-M02': { title: 'Conflicting reports on one fact', ids: ['case-02', 'cl-04', 'cl-05'] },
  'FX-M03': { title: 'Restricted case', ids: ['case-03', 'src-05', 'cl-11'] },
  'FX-M04': { title: 'Auto-acceptable claim', ids: ['cl-06'] },
  'FX-M05': { title: 'Inferred claim that must be reviewed', ids: ['cl-07', 'cand-02'] },
  'FX-M06': { title: 'Sibling cases for similar-case search', ids: ['case-04', 'case-05'] },
  'FX-M07': { title: 'Superseded claim', ids: ['cl-01', 'cl-02'] },
  'FX-M08': { title: 'Lesson with support and counter-evidence', ids: ['lesson-01', 'case-07'] },
  'FX-M09': { title: 'Proposal through both gates with outcome', ids: ['prop-01', 'out-01'] },
  'FX-M10': { title: 'Alias resolution and entity merge', ids: [ORG_GRIDLINE, ORG_GRIDLINE_DUP] },
  'FX-M11': { title: 'Candidate awaiting review', ids: ['cand-01'] },
  'FX-M12': { title: 'Proposal blocked by a conflict', ids: ['prop-02'] },
} as const satisfies Record<string, { title: string; ids: readonly Id[] }>;

export const FIXTURE_IDS = {
  SITE_MESA,
  SITE_HIGH,
  SITE_RIVER,
  SITE_COAST,
  ORG_SOLARIS,
  ORG_GRIDLINE,
  ORG_GRIDLINE_DUP,
  ORG_DESERT,
  MODEL_HELION,
  MODEL_VANTAGE,
  FW_HELION_314,
  FW_HELION_320,
  INV_MR_03,
  INV_HP_02,
  INV_RB_01,
  INV_RB_04,
  INV_CF_01,
} as const;
