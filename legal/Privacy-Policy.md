# Privacy Policy

**DRAFT. NOT LEGAL ADVICE. NOT FOR PUBLICATION UNTIL REVIEWED BY A QUALIFIED LAWYER.**
This draft describes what the software does as of this version. Bracketed items are placeholders.

Effective date: [DATE]
Controller: [LEGAL ENTITY OR NAME], [ADDRESS], [CONTACT EMAIL]

## 1. Scope

This policy covers the PCT command-line tool and web result viewer, as shipped. If a Hosted Service is
offered, a separate section covering it will be added before launch. This draft does not describe a
Hosted Service because none is operated.

## 2. The command-line tool (runs on your machine)

When you run `pct run`:

- It sends requests only to the proxy URL you supply, and to the test origin it starts on your machine.
  It sends detection probes only to the same proxy.
- It does not send telemetry, analytics, or crash reports to the Operator or anyone else.
- It writes a result file only where you tell it to (`--json`). The file contains the proxy URL you gave,
  the declared engine name and version you gave (if any), a public run identifier, timestamps, test
  results, passive detection output, and a hash of the result.
- The run secret is held in memory for the length of the run. It is never written to a file, printed,
  or sent through the proxy.
- Test results can include response headers and short response excerpts from the proxy and the test
  origin. Sensitive header and cookie values are redacted before output. Redaction is a safety net and
  not a guarantee; review a result file before sharing it.

## 3. The web result viewer

- The viewer loads only the result file you point it at, and only from the same origin as the page.
  It does not load results from other origins.
- The viewer does not set cookies and does not contain analytics.
- [VERIFY BEFORE DEPLOYING: the Material Design 3 web components may request external resources such as
  fonts. Audit the network requests of the deployed page and list any third parties here.]

## 4. Hosted Service (not operated)

If a Hosted Service is launched, the Operator intends to collect only what is needed to return results:
result metadata (PCT version, profile, declared engine name and version, timestamps, aggregate scores,
result hash), a salted hash of the requesting IP address kept for rate limiting for no more than
[24 HOURS], and nothing else. The Operator intends not to collect browsing history, arbitrary URLs,
cookies, authentication tokens, passwords, request bodies, response bodies, or unrelated network
traffic, and not to create accounts to run the benchmark. Results will be deleted on request or after
[RETENTION PERIOD]. This section must be confirmed against the implementation before launch.

## 5. Legal bases (where GDPR or similar law applies)

[Describe the lawful basis for each processing activity, if a Hosted Service exists.]

## 6. Sharing

The Operator does not sell personal data. [List any processors, such as hosting providers, once they are
chosen.]

## 7. Your rights

Depending on where you live, you may have rights to access, correct, delete, restrict, or object to the
processing of your data, and to lodge a complaint with a supervisory authority. To exercise them,
contact [CONTACT EMAIL]. For local files written by the command-line tool, you hold and control the data
directly.

## 8. Security

[Describe the measures in place for any hosted data. For local use, the security of result files is your
responsibility.]

## 9. Children

PCT is not directed at children and is not intended for use by anyone under [16 / 18, per jurisdiction].

## 10. International transfers

[Describe transfers, if a Hosted Service exists.]

## 11. Changes

The Operator will post changes here and update the effective date. Material changes will be notified
[HOW] before they take effect.
