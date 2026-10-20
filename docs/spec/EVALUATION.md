# Evaluation protocol

Replaces "test before selecting the stack" with pass criteria that run in CI against the synthetic fixture. Synthetic results do not establish operational readiness; the same questions are re-run on the owner's own data in the owner's deployment before M1 is called done there.

## Question set (M1)

`evaluation/questions.json` holds 30 questions, each tied to a fixture case, with the expected anchor(s) or revision(s) and, where the answer is a fact, the expected claims and cases. `apps/memory-api/src/evaluation.test.ts` runs them in CI through `search()` with k = 5 on the in-memory store and the hash embedder, and scores:

- **Anchor hit rate:** an expected anchor (or revision) is among the top-k hits. Pass ≥ 90 %.
- **Located results:** every hit carries a revision and a locator; a result without a place in a document cannot be returned. Pass = all.
- **Access leaks:** a question asked as `u-jordan` never cites a restricted record (anchor, revision, claim or case). Pass = 0.
- **Conflict disclosure:** a question whose fact is disputed (FX-M02) returns the conflict between the expected claims. Pass = all such questions.
- **Case recall:** an expected case is cited by a hit on at least 80 % of case questions.

What CI cannot score is the written answer: whether Claude, given these results, states only anchored facts and discloses the conflict in prose. That is checked by hand from Claude Desktop with the same questions, and against the owner's own data in the owner's deployment. The set grows with every real case added there.

## Similar-case search (M2)

For every fixture case with a planted sibling (FX-M06 and later additions), the sibling ranks in the top 3, with the key differences listed. Pass = all.

## Reflect job (M3)

Run the reflect job on the fixture: it must produce candidates only (no event other than `record-added candidate` by the reflect actor), and a recorded failed outcome against lesson-01's conditions must produce a candidate that qualifies the lesson. Pass = both.

## Review workflow (M2)

Every review decision is a `review-recorded` event with actor, time and notes; a draft cannot be prepared before gate 1 approves. Pass = fixture replay and API tests.

## Workbench publish (M4)

A published case opens in the Workbench with its evidence links; `u-jordan` cannot reach the restricted case through the Workbench, search, export or assistant context (AC-17). Pass = both.
