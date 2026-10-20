import type { Id, Locator } from './types';

// SYNTHETIC document text for the fixture's sources (MEMORY-SPEC section 10), so retrieval and
// the evaluation set run on the same records as everything else. Each segment is one retrievable
// chunk with the locator a worker would assign; anchors in fixture.ts point at these segments.

export interface DocumentSegment {
  locator: Locator;
  text: string;
}

export interface FixtureDocument {
  sourceId: Id;
  revisionId: Id;
  /** Document, site and page context prefixed to every chunk before embedding. */
  contextPrefix: string;
  segments: DocumentSegment[];
}

const page = (n: number): Locator => ({ type: 'page', page: n });
const row = (n: number, column?: string): Locator =>
  column ? { type: 'row', row: n, column } : { type: 'row', row: n };

/** Exact quotes the fixture's span anchors cite; spans are computed from these at build time. */
export const QUOTES = {
  HP02_STILL_314: 'the unit is on 3.1.4, same as before the visit',
  RODENTS_NOT_OPENED: 'tech thinks it is rodents again but did not open the box',
} as const;

const EMAIL_HP02 = `From: Morgan Hale (Solaris O&M)
To: Avery Moss
Subject: RE: High Plains INV-HP-02 still tripping

Avery, we were back at High Plains on the 11th. INV-HP-02 tripped twice on Tuesday afternoon and once on Wednesday, same DC overcurrent code as before. I checked the controller screen myself and ${QUOTES.HP02_STILL_314}. The work order says the upgrade was applied but the screen does not show 3.2.0. We will send a screenshot on the next visit.

Morgan`;

const EMAIL_RODENTS = `Fw: Rodent damage suspected at River Bend combiner 4

Forwarding from the Gridline tech: ${QUOTES.RODENTS_NOT_OPENED}. Ground fault on INV-RB-04 string 4 came back three times this week. Fuses were not replaced. Requesting a visit to open combiner 4 and photograph the wiring before anything else is changed.`;

export const FIXTURE_DOCUMENTS: FixtureDocument[] = [
  {
    sourceId: 'src-01',
    revisionId: 'rev-01',
    contextPrefix:
      'WO-1001, Mesa Ridge, INV-MR-03 DC fuse replacement, Solaris O&M, September 2026',
    segments: [
      {
        locator: page(1),
        text: 'Work order WO-1001. Site: Mesa Ridge. Equipment: INV-MR-03 (Helion X200, firmware 3.1.4). Reported fault: nuisance DC overcurrent trips, two to four per afternoon, no measured overcurrent on the string monitors. Action: replaced all DC string fuses. Result: trips continued the following afternoon; fuse replacement did not resolve the fault. Vendor: Solaris O&M. Technician: Morgan Hale.',
      },
      {
        locator: page(2),
        text: 'Parts: 24 x 15 A DC string fuses. Labor: 6 hours. Downtime: INV-MR-03 offline 4 hours during replacement. Follow-up: vendor bulletin SB-2026-07 suggests the 3.1.4 overcurrent threshold is too tight at high ambient; recommend firmware upgrade to 3.2.0.',
      },
    ],
  },
  {
    sourceId: 'src-02',
    revisionId: 'rev-02',
    contextPrefix:
      'WO-1002, Mesa Ridge, INV-MR-03 firmware upgrade to 3.2.0, Solaris O&M, September 2026',
    segments: [
      {
        locator: page(1),
        text: 'Work order WO-1002. Site: Mesa Ridge. Equipment: INV-MR-03 (Helion X200). Scope: firmware upgrade from 3.1.4 to 3.2.0 per Helion service bulletin SB-2026-07. Reason: nuisance DC overcurrent trips not resolved by fuse replacement under WO-1001.',
      },
      {
        locator: page(2),
        text: 'Completed 2026-09-09. INV-MR-03 now runs firmware 3.2.0; controller screen confirms version 3.2.0 after reboot. The 3.2.0 release raises the DC overcurrent debounce from 20 ms to 80 ms. No trips recorded for the rest of the day. Downtime: 10 hours including the reboot and verification. Cost: USD 1,850 (labor and travel).',
      },
    ],
  },
  {
    sourceId: 'src-03',
    revisionId: 'rev-03',
    contextPrefix:
      'Email thread, High Plains, INV-HP-02 still tripping, Solaris O&M, September 2026',
    segments: [
      { locator: { type: 'span', start: 0, end: EMAIL_HP02.length, quote: '' }, text: EMAIL_HP02 },
    ],
  },
  {
    sourceId: 'src-04',
    revisionId: 'rev-04',
    contextPrefix: 'WO-1004, High Plains, INV-HP-02 firmware upgrade, Solaris O&M, September 2026',
    segments: [
      {
        locator: row(1),
        text: 'work_order,site,equipment,scope,status: WO-1004, High Plains, INV-HP-02, firmware upgrade 3.1.4 to 3.2.0, closed',
      },
      {
        locator: row(7, 'firmware_after'),
        text: 'row 7: equipment INV-HP-02, firmware_before 3.1.4, firmware_after 3.2.0, verified_by technician, verification_method none recorded',
      },
    ],
  },
  {
    sourceId: 'src-05',
    revisionId: 'rev-05',
    contextPrefix:
      'Coastal Flats warranty claim review (confidential), Gridline Services, September 2026',
    segments: [
      {
        locator: page(1),
        text: 'CONFIDENTIAL. Warranty claim review for Coastal Flats INV-CF-01 (Vantage C1500). IGBT module failure on 2026-09-10, within the five-year warranty period.',
      },
      {
        locator: page(3),
        text: 'Vendor position: Gridline Services disputes coverage, citing operation outside the specified ambient range. Unit firmware at time of failure: 7.0.2. Owner position: the enclosure cooling was serviced to schedule; claim stands. Next step: request the vendor’s temperature log.',
      },
    ],
  },
  {
    sourceId: 'src-06',
    revisionId: 'rev-06',
    contextPrefix:
      'River Bend monthly inverter export, September 2026, CSV from the monitoring system',
    segments: [
      {
        locator: row(1, 'firmware'),
        text: 'row 1: inverter INV-RB-01, model Helion X200, firmware 3.2.0, availability 97.4 %, derate_hours_afternoon 31',
      },
      {
        locator: row(2, 'firmware'),
        text: 'row 2: inverter INV-RB-04, model Vantage C1500, firmware 7.0.2, availability 92.1 %, ground_fault_events 3',
      },
    ],
  },
  {
    sourceId: 'src-07',
    revisionId: 'rev-07',
    contextPrefix:
      'Email, River Bend, rodent damage suspected at combiner 4, Gridline Services, September 2026',
    segments: [
      {
        locator: { type: 'span', start: 0, end: EMAIL_RODENTS.length, quote: '' },
        text: EMAIL_RODENTS,
      },
    ],
  },
  {
    sourceId: 'src-08',
    revisionId: 'rev-08',
    contextPrefix:
      'High Plains derate investigation, Helion X200 fleet, internal report, September 2026',
    segments: [
      {
        locator: page(1),
        text: 'High Plains Helion X200 fleet derate investigation. Symptom: units derate to about 60 % of rated output on afternoons when ambient exceeds 40 °C, June through September. All affected units ran firmware 3.1.4.',
      },
      {
        locator: page(4),
        text: 'Conclusion: the 3.1.4 thermal derate curve starts 8 °C early. After the fleet upgrade to 3.2.0 on 2026-09-17, afternoon derate fell from 40 % to 8 %. Operating condition: ambient above 40 °C, Southwest desert. Limitation: no humidity data; the result may not transfer to Gulf coast sites.',
      },
    ],
  },
  {
    sourceId: 'src-09',
    revisionId: 'rev-09',
    contextPrefix:
      'River Bend derate investigation, Helion X200 fleet, internal report, September 2026',
    segments: [
      {
        locator: page(1),
        text: 'River Bend Helion X200 derate investigation. Symptom matches High Plains: afternoon derate to about 60 % above 40 °C. INV-RB-01 ran firmware 3.1.4 until the September export. Hypotheses: same thermal derate curve as High Plains; blocked enclosure filters.',
      },
      {
        locator: page(2),
        text: 'Operating condition: ambient above 40 °C with Gulf coast humidity. Diagnostic actions: filter inspection; compare derate curves with High Plains. Unresolved: does humidity change the result? Recommendation: upgrade INV-RB-01 to 3.2.0 and inspect filters on the same visit.',
      },
    ],
  },
  {
    sourceId: 'src-10',
    revisionId: 'rev-10',
    contextPrefix:
      'WO-1010, Mesa Ridge, INV-MR-07 firmware upgrade to 7.1.0, Solaris O&M, September 2026',
    segments: [
      {
        locator: page(1),
        text: 'Work order WO-1010. Site: Mesa Ridge. Equipment: INV-MR-07 (Vantage C1500). Scope: firmware upgrade 7.0.2 to 7.1.0 to address afternoon derate. Completed 2026-09-20. Result: derate unchanged over the following week; the upgrade did not help on this model. Next step: cooling fan replacement.',
      },
    ],
  },
  {
    sourceId: 'src-11',
    revisionId: 'rev-11',
    contextPrefix:
      'Photo, River Bend combiner 4 after inspection, Gridline Services, September 2026',
    segments: [
      {
        locator: { type: 'image-region', x: 120, y: 80, w: 400, h: 300 },
        text: 'Photo description: open combiner box 4 at River Bend. String 4 positive conductor shows chewed insulation and exposed copper near the fuse holder; droppings visible on the enclosure floor. Consistent with rodent damage.',
      },
    ],
  },
  {
    sourceId: 'src-12',
    revisionId: 'rev-12',
    contextPrefix: 'Vendor call notes, 2026-10-05, High Plains and River Bend, Asset Management',
    segments: [
      {
        locator: { type: 'whole' },
        text: 'Vendor call 2026-10-05. Gridline response time on P2 work at River Bend has exceeded the 5-day contract target three times this quarter. Technician day rate per the services agreement: USD 950. Gridline will schedule the INV-RB-01 firmware visit for 2026-10-08. Solaris confirmed the High Plains fleet is on 3.2.0 except INV-HP-02, which needs a screenshot.',
      },
    ],
  },
  {
    sourceId: 'src-13',
    revisionId: 'rev-13',
    contextPrefix:
      'Proposal outcome, River Bend INV-RB-01 cooling retrofit and firmware upgrade, October 2026',
    segments: [
      {
        locator: page(1),
        text: 'Outcome report. INV-RB-01 upgraded to firmware 3.2.0 on 2026-10-08; enclosure filters cleaned on the same visit. Over the following 14 days the afternoon derate fell to 6 %, meeting the success criterion of below 10 %. Humidity did not change the result at River Bend.',
      },
    ],
  },
  {
    sourceId: 'src-14',
    revisionId: 'rev-14',
    contextPrefix: 'Email, Gridline Services LLC invoice query, Coastal Flats, September 2026',
    segments: [
      {
        locator: { type: 'whole' },
        text: 'Invoice query from Gridline Services LLC regarding Coastal Flats September service. Gridline Services LLC is the same vendor as Gridline Services; the LLC suffix appears only on invoices.',
      },
    ],
  },
];

export function fixtureDocument(sourceId: Id): FixtureDocument {
  const doc = FIXTURE_DOCUMENTS.find((d) => d.sourceId === sourceId);
  if (!doc) throw new Error(`no fixture document for ${sourceId}`);
  return doc;
}

/** The span locator for a quote inside a document whose first segment holds the full text. */
export function spanOf(sourceId: Id, quote: string): Locator {
  const text = fixtureDocument(sourceId).segments[0]!.text;
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`quote not found in ${sourceId}: ${quote}`);
  return { type: 'span', start, end: start + quote.length, quote };
}
