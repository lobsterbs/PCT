# Open Questions (block specific phases)

These are problems with the spec as written. Each one needs a decision before the phase listed. Pushback included because the spec glosses over them.

## Q1. Adapter protocol cannot cover Service Worker proxies (blocks Phase 9)
The spec's navigate(target) assumes PCT can drive the browser to a URL and the proxy handles it. Service Worker proxies intercept normal browsing and may only activate after registration on the same origin. A URL-only adapter cannot test them honestly.
Recommendation: the adapter owns "how traffic reaches the proxy" (browser proxy setting, URL prefix, SW bootstrap). PCT owns "what to test." Define adapter types by routing mechanism, not by product.

## Q2. How traffic gets routed in the browser (blocks Phase 4)
Two options: (a) Chromium --proxy-server launch flag, which routes everything including fixture origins, or (b) rewrite-URL adapters only. Option (a) is cleaner for non-rewriting proxies. Rewrite proxies (Scramjet, UV style) change the page itself, so the browser-level flag alone will not test them correctly. Need a decision per adapter type.

## Q3. Fetcher confidence percentages are not real yet (blocks Phase 8)
The spec's example shows "Node/undici-like, 78%". Right now that number has no basis. A confidence score only means something after calibration: collect real request traces from undici, node http, curl, axios, and browser fetch against the same fixtures, then measure how often signals separate them. Until that exists, the UI should show the matched signals and evidence, not a percentage.
Recommendation: no percentage in v1. Show "Matched signals: 5 of 7 for node-undici-like" with the list.

## Q4. "Verified results" need a trust root (blocks Phase 11 verification, not earlier)
A signed result signed by a key you hold is just a stamp, not verification. Without an external trust model (who runs PCT, who holds the key, how a third party checks), "verified" is a marketing word. Defer signing entirely until this is designed. Hashing and reproducibility work without it.

## Q5. Anti-special-casing is weaker than the spec suggests (affects Phase 3 and 5)
PCT is open source. A proxy can read the test code and pattern match paths, query shapes, and fixture structure. Per-run nonces and generated payloads raise the cost of cheating but do not prevent it. The honest claim is "cheating requires implementing the behavior or writing targeted code that breaks on the next test revision," not "cannot be gamed." Document it that way.
Also: randomized paths must still be stable enough for the test to be reproducible. Decide the seed rule.

## Q6. SSRF boundary (blocks Phase 3 and 12)
The runner sends the browser to a user-supplied proxy URL. That is fine. The danger is any server-side component that fetches URLs on a client's behalf. Rule: PCT's server never fetches a client-supplied URL. Fixture targets are a closed set of PCT-owned origins. Add a test that proves the server rejects arbitrary target parameters.

## Q7. Scoring spec has internal inconsistencies (blocks Phase 6)
- Example shows "Overall 91.4%" and "Compatibility 92%" in the same block. Pick one name for the headline number.
- Grade bands (A-, B, C...) are never defined. Need a table.
- Critical caps are listed as grades but there is no rule for which test IDs are "critical." Need an explicit list.
- Partial weighting: "partial" status needs a numeric value (0.5 is the obvious default). Write it down.

## Q8. Design system sources (blocks Phase 10)
The spec cites matraic.github.io/m3e and materialwebunofficial.github.io. Both are third-party or unofficial. Use them as reference only. Build against the official Material 3 tokens and the m3-expressive-web component library's documented values, then verify spec values against official docs before shipping. The spec also says "Material You 3 Expressive": Material 3 Expressive is the name Google uses, "Material You" is the branding around Material 3. Pick one term in the UI copy and stay consistent.
Also check font licensing before shipping Google Sans Flex.

## Q9. Test count vs profile sizes (minor)
Quick ~30, Standard ~100, Full ~200, but spec target is 150 to 250. Quick and Standard are subsets. Confirm Full lands inside 150 to 250 before calling it canonical.

## Q10. Who hosts and who runs the public instance? (blocks Phase 12 and any public leaderboard)
Spec says no account for local use and no tracking. A public instance still needs logs for abuse control. Decide what gets logged and for how long before writing privacy text.
