# REA 6.7.0 native executable verification patch

This directory preserves CAUCOLabs' local changes to `rea-agents@6.7.0` from
[morluto/rea](https://github.com/morluto/rea). Upstream REA is copyright (c) 2026
morluto and licensed under MIT; its unmodified license is included as `LICENSE`.
Vendoring continues to preserve upstream LICENSE, THIRD_PARTY_NOTICES.md,
DISCLAIMER.md and license files. This is a downstream patch, not an upstream
release or endorsement.

The patch reproduces the already-tested local implementation byte-for-byte:

1. Replace only the helper's executable hashing block and add post-hash process
   path/launch revalidation in `bridge/native/ReaNativeUI.swift`.
2. Add the verifier compilation input to `dist/native/NativeUiHelperRuntime.js`.
3. Add `bridge/native/NativeExecutableIdentity.swift` from this directory.

No observation engine, schemas, resolver digest, process/window checks,
permission checks, execution deadlines or output budgets are replaced.

## Provenance and integrity

The original was retrieved from the existing pinned source,
`https://registry.npmjs.org/rea-agents/-/rea-agents-6.7.0.tgz`, using
`npm pack rea-agents@6.7.0 --ignore-scripts` in temporary staging. The archive was
independently compared to npm's published SHA-512 integrity and SHA-1 metadata
before extraction. No upstream lifecycle scripts ran.

`manifest.json` records the registry tarball, SHA-512 integrity, measured archive
SHA-256, package identity/version, original file SHA-256 hashes, patched file
SHA-256 hashes, patch asset hash, format version and ordered operations. The new
Swift file must be absent in the original tree. Its patched hash also verifies
the checked-in source asset. These checks trust the reviewed repository manifest
and npm registry provenance; they are not an independent upstream signature.
The apply script checks the relevant extracted inputs, not the entire tarball or
all upstream files/dependencies. The normal dependency installation remains
responsible for its lockfile integrity checks.

`native-executable-verification.patch.json` uses `exact-byte-edits-v1`:
UTF-8 before/after strings at explicit zero-based byte offsets in the original
file. Edits are ordered and nonoverlapping. The complete original file hash,
exact removed bytes, and complete output hash must match. No context search,
line-ending conversion, fuzzy matching, external `patch` command or dependencies
are used. New or changed upstream releases require explicit review and new pins.
The local `.gitattributes` disables checkout newline conversion for these assets.
Already-patched and partially-patched trees are rejected; reapplying is not a
silent no-op.

## Application and vendoring

For an **exclusively owned staging tree** containing original REA files:

```sh
node scripts/apply-rea-patches.mjs /path/to/staged/rea --check
node scripts/apply-rea-patches.mjs /path/to/staged/rea
```

All source and asset hashes, exact edits, and computed output hashes are checked
before writing any target file. Written hashes are checked again. Use staging:
standalone application is not a multi-file transaction against concurrent writers
or process termination. An interrupted write may leave a partial staging tree,
which the next application rejects; discard and reconstruct that fixture/tree.
The input tree and patch assets must not be concurrently modified. Symlink
components beneath the selected roots are rejected, but metadata checks do not
claim to eliminate filesystem races.

`scripts/vendor-engine.mjs` validates the original source before changing its
destination. It copies upstream files and dependencies into a separate sibling
staging directory, applies this patch, then inventories the patched files.
`distribution.json` includes all three resulting file hashes and a `patches`
entry containing this manifest's SHA-256. Inventory generation still hashes every
copied file. Only the complete patched/inventoried tree is published. The previous
destination is retained until publication succeeds, with rollback on rename
failure. A failed rollback retains the previous tree for recovery. Do not run
concurrent vendoring jobs against the same destination; the directory swap is
not crash-atomic and there is a brief gap between renames.

`prepare-platform-runtime.mjs` retains the pinned package and dependency flow,
explicitly disables pack lifecycle scripts, and invokes the same vendor script.
Never vendor from an already-patched runtime; use the original pinned package
with installed production dependencies.

## Validation

```sh
npx vitest run tests/reaPatches.test.ts
python3 scripts/native-verification/run_tests.py
npm run check
npm test
npm run build
```

Patch tests use temporary destinations, checking rejection without writes,
computed/written hashes, preservation of unrelated files, output inventory,
provenance, and protection of the destination when source/dependency validation
fails. They derive exact baseline fixtures from the locally available original
or patched runtime and require the independently recorded original hashes. The
existing project suite also requires the prepared runtime. A separate temporary
end-to-end validation was run using the verified npm package and the available
local dependency installation; the active runtime was not re-vendored.

Re-vendoring regenerates the distribution inventory. Merely adding these patch
assets does not refresh an existing active runtime's old inventory. The patch
preserves bounded-memory verification, but filesystem TOCTOU limitations and
capture timeouts remain; see `scripts/native-verification/README.md`.
