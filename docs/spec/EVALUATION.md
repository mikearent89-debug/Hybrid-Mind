# Evaluation protocol

Replaces "test before selecting the stack" with pass criteria that run in CI against the synthetic fixture. Synthetic results do not establish operational readiness; the same questions are re-run on the owner's own data in the owner's deployment before M1 is called done there.

## Question set (M1)

`evaluation/questions.json` holds 30 questions, each with the expected anchor(s) and, where the answer is a fact, the expected claim. A run scores:

- **Anchor hit rate:** the answer cites at least one expected anchor. Pass ≥ 90 %.
- **Unanchored answers:** any answer that states a fact without an anchor. Pass = 0.
- **Access leaks:** any answer for `u-jordan` that cites a restricted record. Pass = 0.
- **Conflict disclosure:** a question whose fact is disputed (FX-M02) is answered with the conflict, not one side. Pass = all such questions.

The seed below is the first 8 questions; the set grows to 30 with M1 and with every real case added in deployment (owner's data stays in the owner's deployment).

## Similar-case search (M2)

For every fixture case with a planted sibling (FX-M06 and later additions), the sibling ranks in the top 3, with the key differences listed. Pass = all.

## Reflect job (M3)

Run the reflect job on the fixture: it must produce candidates only (no event other than `record-added candidate` by the reflect actor), and a recorded failed outcome against lesson-01's conditions must produce a candidate that qualifies the lesson. Pass = both.

## Review workflow (M2)

Every review decision is a `review-recorded` event with actor, time and notes; a draft cannot be prepared before gate 1 approves. Pass = fixture replay and API tests.

## Workbench publish (M4)

A published case opens in the Workbench with its evidence links; `u-jordan` cannot reach the restricted case through the Workbench, search, export or assistant context (AC-17). Pass = both.
