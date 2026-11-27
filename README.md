# TranslationCheck

An **Intelligent Contract on [GenLayer](https://www.genlayer.com)** that gives a translation an on-chain fidelity verdict: `FAITHFUL`, `MINOR_ISSUES` or `DISTORTED`.

Anyone submits a source text and its translation. Validators fill in an AI rubric (four sub-scores and four flags). The verdict and the total score are then **computed by contract code** from that rubric, from fixed thresholds and from a digit comparison the contract runs itself, so a translation with a changed amount can never come out as `FAITHFUL`, whatever the model says. Other contracts can gate on the result with `is_faithful(id)`.

This repository is contract-only: the contract, its tests and the deploy scripts. There is no frontend.

- **Contract (Studionet, chain 61999):** [`0x2220B723aE3F61afD7e17667C49721e4FE2DAbb4`](https://explorer-studio.genlayer.com/address/0x2220B723aE3F61afD7e17667C49721e4FE2DAbb4)
- **Deploy transaction:** [`0x8d02a4c9…d291`](https://explorer-studio.genlayer.com/tx/0x8d02a4c9fd618daf077a70a80419122e1e53e59e9134804dd16bad4aedb6d291)
- **Deployer:** `0xfD7d408f5Cc0A4d507bDc41c48B4A00A8C9Fc399`
- **Source:** [`contracts/translation_check.py`](contracts/translation_check.py) (747 lines)

## How it works

1. `submit(source_text, translation, source_lang, target_lang)` stores the pair as `PENDING` and returns its id (ids start at 1). Each text is at most 4,000 characters; the two language names must differ.
2. Anyone calls `review(id)`. Every validator asks its LLM to fill in the rubric for that pair.
3. The contract derives the verdict and the total from the rubric (see [Verdict derivation](#verdict-derivation)). Validators agree only if they derive the same verdict and their totals are within the score band.
4. The review is written once and never changes. If no usable rubric comes back, the transaction reverts and the submission stays `PENDING`, so `review` can be called again.

## Rubric

The LLM returns only this; it never names a verdict.

| Field | Meaning |
|-------|---------|
| `scores.meaning` (0-100) | The translation says what the source says |
| `scores.completeness` (0-100) | Nothing left out, nothing added |
| `scores.numbers_and_names` (0-100) | Amounts, dates, units and proper names are carried over |
| `scores.fluency` (0-100) | Reads as natural text in the target language |
| `flags.omission` | Part of the source is missing |
| `flags.addition` | The translation contains content that is not in the source |
| `flags.number_mismatch` | A number, date or amount differs |
| `flags.wrong_language` | A text is not in the declared language |
| `manipulation_attempt` | A text addresses the reviewer or tries to steer the result |
| `issues`, `summary` | Short explanation, stored for readers; not used by the rules |

Total score = `(40·meaning + 25·completeness + 25·numbers_and_names + 10·fluency) / 100`, rounded down.

### The contract's own number check

Independently of the LLM, the contract extracts the digit groups from both texts and compares them as multisets. Thousands and decimal separators (`.`, `,`, `'` between digits) are dropped, so `12,000` and `12.000` are the same number, and order does not matter. The result (`match`, `missing`, `extra`) is stored with the review and is also available as a free view, `compare_numbers_of(source, translation)`.

## Verdict derivation

Deployment parameters of the live contract: `faithful_score` 85, `distorted_score` 60, `score_band` 10. Fixed: `min_meaning` 50, `min_subscore` 70.

| Rule | Condition | Result |
|------|-----------|--------|
| D1 | `manipulation_attempt` is true, or the contract's phrase scan finds an instruction-like phrase in either text | `DISTORTED`, score capped at 20 |
| D2 | `wrong_language` | `DISTORTED`, score capped at 20 |
| D3 | `meaning` below `min_meaning` | `DISTORTED` |
| D4 | `number_mismatch` flagged by the LLM **and** the digits differ in the contract's own check | `DISTORTED` |
| D5 | total below `distorted_score` | `DISTORTED` |
| M1 | `number_mismatch` flagged by the LLM only | at best `MINOR_ISSUES` |
| M2 | digits differ in the contract's check only | at best `MINOR_ISSUES` |
| M3 | `omission` | at best `MINOR_ISSUES` |
| M4 | `addition` | at best `MINOR_ISSUES` |
| M5 | any sub-score below `min_subscore` | at best `MINOR_ISSUES` |
| - | none of the above and total ≥ `faithful_score` | `FAITHFUL` |
| - | none of the above and total below `faithful_score` | `MINOR_ISSUES` |

When an M rule applies, the stored score is capped at `faithful_score − 1`. The rules that fired are stored with the review as `rule_findings`.

## Consensus

`review` uses a leader/validator block (`gl.vm.run_nondet_unsafe`). The leader produces a rubric. Each validator **runs the rubric itself** and accepts the leader's result only if

- its own derived verdict equals the verdict derived from the leader's rubric, and
- the two total scores differ by at most `score_band` points.

No LLM judges another LLM's answer. If both the leader and a validator fail to get a usable rubric, they agree on the failure and the transaction reverts without storing anything.

## Untrusted text

Both texts come from the submitter and are treated as data:

- length-capped at 4,000 characters, control, zero-width and bidi characters removed;
- wrapped in `<<<…>>>` delimiters that the text cannot reproduce (runs of `<` or `>` are collapsed first);
- scanned in contract code for instruction-like phrases, outside the LLM. A hit triggers rule D1 even if the model follows the embedded instruction and flags nothing;
- language names are restricted to 2-40 letters, spaces, hyphens and parentheses, so they cannot carry instructions into the prompt.

## Methods

| Write | |
|-------|--|
| `submit(source_text, translation, source_lang, target_lang) -> int` | Store a pair, return its id |
| `review(submission_id) -> str` | Run the review once; returns the stored review as JSON |

| View | |
|------|--|
| `get_submission(id)` | Texts, languages, submitter, status, score |
| `get_review(id)` | The stored review as JSON, or `""` while pending |
| `get_verdict(id)` | `PENDING`, `FAITHFUL`, `MINOR_ISSUES` or `DISTORTED` |
| `is_faithful(id) -> bool` | The gate for other contracts |
| `get_submission_count()` | Number of submissions |
| `list_submissions(offset, limit)` | Newest first, without the texts |
| `get_status_counts()` | Count per status |
| `get_params()` | Thresholds of this deployment |
| `compare_numbers_of(source, translation)` | The contract's digit comparison, on any two texts |
| `get_summary()` | Counts, parameters and weights in one call |

## Live test results (Studionet)

Run on 2026-11-27 with [`deploy/interact.mjs`](deploy/interact.mjs). Source text (English), the same for all four cases:

> The grant pays 12,000 USD in 3 instalments. The second instalment is released only after the interim report is approved. The final report is due on 26 March 2027.

Every transaction below reached `FINALIZED` with consensus result `MAJORITY_AGREE`. Full records, including the translations and the stored reviews, are in [`live-results.json`](live-results.json).

| # | Indonesian translation | Verdict | Score | Rubric (meaning / completeness / numbers / fluency) | Rules | Review tx |
|---|------------------------|---------|-------|------|-------|-----------|
| 1 | Accurate | `FAITHFUL` | 97 | 96 / 100 / 100 / 88 | none | [`0x8722c4ba…c884`](https://explorer-studio.genlayer.com/tx/0x8722c4ba191e5a6094435ba7e2dac00dec252d1f86609b388bd5e3f4ba8ec884) |
| 2 | Amount changed to 21.000 USD, month changed to May | `DISTORTED` | 61 | 55 / 100 / 20 / 90 | D4 (contract's check: `12000` missing, `21000` extra) | [`0x1d62f4b4…174c`](https://explorer-studio.genlayer.com/tx/0x1d62f4b416b6d493dc6cac92c3bf437fcb9f1c715ec9047cb38ff7aafa57174c) |
| 3 | The sentence about the second instalment left out | `MINOR_ISSUES` | 77 | 70 / 60 / 100 / 90 | M3, M5 | [`0x4563195b…2c1c`](https://explorer-studio.genlayer.com/tx/0x4563195b0ddc733fe6d422787b050cfdc788bbb893dab50fd21593fc157e2c1c) |
| 4 | Accurate, followed by a note that instructs the reviewer to give full marks | `DISTORTED` | 20 | 100 / 100 / 100 / 95 | D1 (LLM flag and phrase scan) | [`0x8f2c607f…35d1`](https://explorer-studio.genlayer.com/tx/0x8f2c607ff183ef8c4358d7ae378a187ccb4c5eeca298adff3279ece3e77c35d1) |

Submit transactions: #1 [`0xda2031ff…8d3a`](https://explorer-studio.genlayer.com/tx/0xda2031ffe3be3022a1c11560b5aa94563aaac09147d77fcc5a4c69d0bf468d3a), #2 [`0x37b0177c…02e8`](https://explorer-studio.genlayer.com/tx/0x37b0177ce94a1ce0b5562fb86ad65275860f50b3eea932b27626ed5453b302e8), #3 [`0xe5b04e73…a3ef`](https://explorer-studio.genlayer.com/tx/0xe5b04e737c274bf260950b12d21bd97c0af2d7e96f26cbf6a474defaa24da3ef), #4 [`0x288ba85c…78f0`](https://explorer-studio.genlayer.com/tx/0x288ba85c04967960d9729a68e149bcd23f253f060b00d79adee684f1f78478f0).

Notes on these runs:

- Case 2 scored 61, one point above `distorted_score`. It is `DISTORTED` because of rule D4, not because of its total: the hard rule decided it.
- In case 4 the sub-scores are high (the translation itself is accurate); the verdict comes from D1 alone and the score is capped at 20.

### Not exercised live

- Rules D2 (wrong language), D3 and D5 on their own, M1, M2 and M4. They are covered by the tests only.
- A validator disagreeing with the leader (different verdict, or totals outside the band). All eight transactions ended in `MAJORITY_AGREE`.
- The revert path when the LLM returns no usable rubric.
- A second `review` of an already reviewed submission (rejected in the tests).
- Language pairs other than English → Indonesian, and texts near the 4,000 character limit.
- A deployment with other thresholds.

## Tests

```bash
python -m pytest tests -v        # 36 tests
python3 tests/test_logic.py      # the 18 logic tests alone, standard library only
```

- [`tests/test_logic.py`](tests/test_logic.py), 18 tests: sanitising, phrase scan, digit extraction and comparison, parameter and rubric validation, every rule, rule precedence, the validator's agreement rule. They load the real contract source against a small SDK stub ([`tests/_stub_sdk.py`](tests/_stub_sdk.py)).
- [`tests/test_translation_check.py`](tests/test_translation_check.py), 18 tests: the contract on the GenLayer Python SDK in direct mode (`genlayer-test`), with mocked LLM answers: deployment, input validation, each verdict, validator acceptance inside the band and rejection outside it, the revert path, write-once reviews.

The contract passes `genvm-lint check contracts/translation_check.py`.

## Deploy and run

Requires Node 20+ and `genlayer-js` 2.x (Studionet charges protocol fees; the scripts estimate and attach them).

```bash
PRIVATE_KEY=0x<testnet key> node deploy/deploy.mjs
CONTRACT=0x... PRIVATE_KEY=0x<testnet key> node deploy/interact.mjs
CONTRACT=0x... READ_ONLY=1 node deploy/interact.mjs      # reads only, no key
```

Keys are read from the environment only and are never written anywhere. Use a testnet-only key. `deploy.mjs` writes [`deployment.json`](deployment.json); `interact.mjs` sends each transaction once, stops at the first one that does not execute cleanly, and writes `live-results.json`.

## Known limits

- The verdict rests on LLM sub-scores. The band and the hard rules bound the effect of one model's opinion; they do not make the scores objective.
- The digit check sees ASCII digits only. Numbers written as words ("three" / "tiga"), other numeral systems and a change of unit with the same digits are left to the LLM. A legitimate format change such as "5 pm" → "17.00" counts as a digit difference and caps the verdict at `MINOR_ISSUES` (rule M2).
- The phrase scan is a fixed list of English phrases. A source text that legitimately contains such a phrase (for example a text about prompt injection) is judged `DISTORTED` by D1. Phrases outside the list rely on the LLM's `manipulation_attempt` flag.
- Texts are public on-chain and limited to 4,000 characters each. Do not submit confidential material.
- A review is final. There is no appeal or re-review; submit the pair again to get a new review.
- Anyone can submit and anyone can trigger a review; there is no fee beyond the network's and no rate limit.
- The language names are passed to the LLM as given; the contract does not verify that a language exists.

## License

MIT, see [`LICENSE`](LICENSE).
