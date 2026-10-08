# Scoring Proposal (DRAFT v0.1, NOT LOCKED)

Every number here is a proposal for review. Change anything you disagree with, then we lock PCT 1.0.

## 1. Headline metric
One canonical number: **Compatibility**, a percentage with one decimal, plus a grade.

```text
Compatibility: 91.4%
Grade: A-
```

There is no separate "Overall". Category scores are labeled by category name and never called overall or compatibility.

```text
Networking: 96.0%
Security:   95.0%
WebSocket:  82.0%
```

Transport analysis is not a score. It appears in its own panel (see FETCHER_ANALYSIS).

## 2. Test result values
| Status | Credit | Notes |
|---|---|---|
| PASS | 1.0 | Expected behavior observed |
| PARTIAL | 0.5 | Behavior present but degraded (documented per test) |
| FAIL | 0.0 | Expected behavior absent |
| SKIP | excluded | Browser lacks the API. Removed from numerator and denominator |
| ERROR | 0.0 and flagged | Test harness failure, timeout, or cleanup failure. See section 7 |

PARTIAL at 0.5 is a default. A test may declare a different partial value in its definition, with a reason. Default values are reviewed, not tuned per engine.

## 3. Test weights
Each test has a tier weight:
| Tier | Weight | Meaning |
|---|---|---|
| core | 3 | Breaking this breaks most real sites |
| standard | 2 | Breaks a common feature |
| edge | 1 | Spec corner case or uncommon feature |

Within a category:
```text
category score = sum(credit * tierWeight) / sum(tierWeight of non-skipped tests)
```

## 4. Category weights (draft)
| Category | Weight |
|---|---|
| HTML | 8 |
| JavaScript | 10 |
| Networking | 12 |
| Streaming | 6 |
| WebSocket | 6 |
| Forms | 6 |
| Cookies | 7 |
| Storage | 5 |
| Workers | 5 |
| Security | 12 |
| Navigation | 8 |
| CSS | 4 |
| Media | 4 |
| Downloads | 2 |
| Performance | 5 |
Sum: 100.

Compatibility before caps:
```text
sum(categoryScore * categoryWeight) / 100
```

Categories with zero non-skipped tests are excluded and the remaining weights are renormalized. Renormalization is reported in results.

## 5. Critical tests
A critical test marks a failure that fundamentally breaks compatibility or security. Proposed initial list (see section 8 for reasoning):

| Test ID | Why critical |
|---|---|
| origin.isolation.001 | Cross-origin storage visible to another origin. Security failure |
| cookies.isolation.001 | Cookie from one origin readable by another. Security and session failure |
| navigation.core.001 | Top-level navigation through the proxy does not render the target page |
| networking.body-integrity.001 | Request body differs from what was sent |
| networking.response-integrity.001 | Response body differs from the origin response |
| fetch.post-body.001 | fetch POST body dropped or altered (common, separate from raw integrity) |

Six is the starting point. Every additional critical test needs a written reason and a PR review.

## 6. Critical caps
A cap is a ceiling on the final score, applied after weighting. Caps apply only on FAIL, never PARTIAL or ERROR.

| Failed critical test | Max final score | Max grade |
|---|---|---|
| origin.isolation.001 | 76.9 | C |
| cookies.isolation.001 | 69.9 | D |
| navigation.core.001 | 76.9 | C |
| networking.body-integrity.001 | 69.9 | D |
| networking.response-integrity.001 | 69.9 | D |
| fetch.post-body.001 | 76.9 | C |

Multiple caps: the lowest ceiling wins. Caps are shown in results next to the score: "Capped at C: origin.isolation.001 failed."

## 7. ERROR handling
An ERROR is a harness problem, not a proxy verdict. Rules:
1. If ERROR count is 2% or less of tests in the profile, the test is excluded from scoring and the result is marked "incomplete: N errors".
2. If above 2%, the run is invalid. No score or grade is produced. The result stays stored for debugging.
3. An ERROR on a critical test invalidates the run regardless of percentage. A critical test must produce a verdict.

## 8. Grade bands (draft)
| Score | Grade |
|---|---|
| 97.0 to 100 | A+ |
| 93.0 to 96.9 | A |
| 90.0 to 92.9 | A- |
| 87.0 to 89.9 | B+ |
| 83.0 to 86.9 | B |
| 80.0 to 82.9 | B- |
| 77.0 to 79.9 | C+ |
| 73.0 to 76.9 | C |
| 70.0 to 72.9 | C- |
| 60.0 to 69.9 | D |
| below 60 | F |

Caps use the top of the band. "Max 76.9" means the grade cannot exceed C.

## 9. Rounding and tie-breaking
- Scores are computed as floats and rounded to one decimal for display only.
- Grade is derived from the rounded score, so 92.95 displays 93.0 and grades A.
- Comparisons between two results use unrounded values.
- Equal scores: the result with more PASS tests ranks higher. Still equal: display both, no ranking.

## 10. Benchmark versioning
- Format: `PCT <major>.<minor>` for the suite, plus `profile` (quick, standard, full), plus per-test `revision`.
- Scores are comparable only when suite version, profile, and all included test revisions match.
- Patch releases may fix a test bug. A fix that changes what a test expects bumps that test's revision, and a result summary lists which revisions changed.
- Quick scores are never compared with Full scores. The UI blocks the comparison.

## 11. Explicit non-goals of scoring
- No score is adjusted for the declared engine.
- No score includes the inferred transport.
- No AI or subjective judgment enters a score.
- Browser features the benchmark browser lacks are skipped, never failed.

## 12. Review checklist before locking
- [ ] Category weights agreed
- [ ] Tier weights agreed
- [ ] PARTIAL default value agreed
- [ ] Critical test list agreed (each with a reason)
- [ ] Caps agreed
- [ ] ERROR thresholds agreed
- [ ] Grade bands agreed
