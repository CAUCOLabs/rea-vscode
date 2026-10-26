# REA 6.7.0 dependency remediation

The retained REA production graph contained fast-uri 3.1.8 (moderate) and Zod
4.4.3 (high). The former is used by AJV; the latter is an exact upstream direct
dependency shared with MCP clients/servers and incur.

| Package | Original | Packaging resolution |
| --- | --- | --- |
| rea-agents | 6.7.0 | 6.7.0 |
| ajv | 8.20.0 | 8.20.0 |
| fast-uri | 3.1.8 | 3.1.9 |
| zod | 4.4.3 | 4.6.7 |

The baseline npm audit reported four fast-uri advisories with affected ranges
ending before 3.1.9: [scheme spoofing](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
[path equivalence](https://github.com/advisories/GHSA-xhq7-xmqj-769h),
[host canonicalization](https://github.com/advisories/GHSA-wjr9-j795-jxcr), and
[suffix scheme injection](https://github.com/advisories/GHSA-333x-w4r6-6crp).
The [Zod memory exhaustion advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
affects versions below 4.6.6. Both selected replacements fall outside all of
these reported ranges.

## Packaging policy

`scripts/rea-security-dependencies.mjs` requires the exact original upstream
manifest SHA-256 (`3f6c47fb12c8388f291a21e7f99a876495d03aee671b3b6a0708dd12d6ebb570`).
The original manifest is retained as a test fixture. Only a disposable extraction
is adjusted; the release tarball and protected runtimes are untouched.

The helper changes the direct Zod spec to 4.6.7, preserves upstream overrides,
and adds `zod: "$zod"` and `fast-uri: "3.1.9"` overrides. Referencing the direct
Zod spec avoids npm's EOVERRIDE conflict with an exact direct dependency. Changing
only the lockfile would leave that direct spec inconsistent with npm ci.

The retained `build/rea-package-lock.json` preserves every other package record.
Only the root Zod spec and the fast-uri/Zod version, registry URL and SHA-512
integrity fields differ. A regression digest covers the rest of the graph. A
narrow Git ignore exception retains this lockfile without exposing other build
artifacts. No npm update or forced resolution is used.

Preparation applies the policy before scripts-disabled production npm ci and
checks installed versions afterward. Vendoring checks versions again before and
after copying, retains all source patches, and generates the existing SHA-256
inventory plus security dependency provenance. Runtime validation checks that
provenance and installed versions after verifying the inventory. Existing
unmarked baseline runtimes remain verifiable; this change does not retrofit them.

## Isolated reproduction

From the repository root, with Node 26.8.1 and npm available:

```sh
project="$PWD"
fixture=$(mktemp -d /tmp/rea-security-review-XXXXXX)
npm pack rea-agents@6.7.0 --ignore-scripts --pack-destination "$fixture" --silent
tar -xzf "$fixture/rea-agents-6.7.0.tgz" -C "$fixture"
node --input-type=module - "$fixture/package" <<'JS'
import { prepareReaSecurityDependencies } from './scripts/rea-security-dependencies.mjs';
await prepareReaSecurityDependencies(process.argv[2]);
JS
cd "$fixture/package"
npm ci --omit=dev --include=optional --ignore-scripts
npm ls fast-uri zod ajv --all --omit=dev
npm ls --all --omit=dev
npm audit --omit=dev --json
cd "$project"
REA_SECURITY_TEST_ARCHIVE="$fixture/rea-agents-6.7.0.tgz" \
  npx vitest run tests/reaSecurityDependenciesLive.test.ts
```

The live regression uses two offline npm ci runs with the warmed cache. Set
`REA_SECURITY_NPM_CACHE` when using a nondefault cache, and optionally
`REA_SECURITY_TEST_REPORT` to retain its JSON result. Without an archive, the
live test is explicitly skipped; ordinary policy tests remain enabled. The
archive must be the original upstream release, not a locally adjusted package.
All installation, vendoring, candidate saving and integrity-tampering fixtures
are created under a fresh OS temporary directory and removed afterward.

## Verification and limits

Verified on macOS arm64 with Node 26.8.1 and npm 11.19.0:

- Clean production npm ci: 173 installed packages; no lifecycle scripts executed.
- Full installed production tree: valid; two subsequent clean installs identical;
  retained lockfile unchanged by npm ci.
- Baseline audit: 2 vulnerable packages (1 moderate, 1 high). Remediated audit:
  0 vulnerabilities of any severity, including no additional production findings.
- REA CLI: 6.7.0. Native `@lydell/node-pty`: loads successfully.
- Patched, vendored MCP server: initialized; 207 tools discovered; valid
  `list_unknowns` and `get_evidence_bundle` calls; invalid input rejected.
- 6,170 vendored files verified; modified Zod metadata rejected by inventory
  validation; candidate and active-runtime fixture sentinels preserved.

This is representative MCP compatibility coverage, not a test of every tool.
Plist analysis was attempted but provider setup was blocked by Swift compiler
cache permissions in the sandbox; deep providers, browser/UI tools, credentials,
and external services are not verified here. Optional Frida lifecycle scripts
remain disabled, and Frida remains excluded from vendoring. Audit results are a
time-specific registry assessment, not a guarantee against future advisories.
Linux and Windows have not been exercised. Full runtime preparation was not run;
Node archive download/extraction was not retested. Existing runtime path-race and
power-loss limitations in runtime-candidate-safety.md still apply. The policy
fails closed on upstream manifest drift and requires explicit review for a new
REA release or security resolution.
