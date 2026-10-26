# Runtime candidate safety

Candidates are stored as `.runtime-candidates/<target>-<id>/runtime`.
`saveRuntimeCandidate` returns the inner runtime path as `candidatePath`; pass
that path to validation or publication. The outer directory is an exclusive
reservation, created with non-recursive mkdir. Collisions (including files or
symlinks) reject without moving staging. Renaming onto the reservation itself
would allow replacement of an empty directory on POSIX systems.

The staged runtime is validated before placement and again afterward. A failed
move removes only the empty reservation using rmdir. A failed validation after
placement retains the moved runtime and reports its recovery path; automatic
restoration could overwrite a newly recreated staging path. An interrupted save
can leave an empty reservation or an unvalidated runtime child. Do not infer
validity from directory presence: explicitly validate before use. Never delete
these directories automatically to retry an ID. Preparation retains its staging
directory on failure, including publication or recovery failures.

The reservation coordinates concurrent cooperating saves on macOS, Linux and
Windows without requiring a platform-specific no-replace rename. Validation and
publication accept the returned inner path. Existing flat candidate paths remain
usable; no migration or cleanup is performed.

## Publication validation and rollback

Production publication requires an explicit target: `darwin-arm64`,
`darwin-x64`, `linux-x64`, or `win32-x64`. It never derives this value from
candidate metadata. Finalization forwards the selected preparation target.

The exclusive publication lock covers this entire sequence:

1. Check source containment and real parent directories; reject unresolved
   backup or cleanup paths.
2. Check candidate structure, then run `validatePreparedRuntime(source, target)`:
   REA inventory hashes, distribution metadata, patch provenance, security
   dependencies when marked, and bundled Node integrity and reported version.
3. Check any existing active runtime's structure. The previous runtime remains
   untouched until candidate validation completes successfully.
4. Move the previous runtime to backup, then move the candidate into `runtime`.
5. Check published structure and run the same full validator on the published
   path with the same explicit target. Only then declare publication successful.
6. Preserve the backup when requested. Otherwise the existing cleanup policy
   marks the backup cleanup-only before deleting it; no cleanup occurs before
   published validation succeeds.

A pre-publication validation failure leaves both the candidate and active
runtime in their original locations and releases the lock. After placement, a
validation failure first preserves the new runtime in diagnostics, then restores
its predecessor. Existing diagnostics are retained, including empty directories;
a unique diagnostic name is used when the default directory already exists.
If diagnostic relocation or restoration fails, an AggregateError reports the
incomplete rollback and data is retained for manual recovery. A validation
failure without a predecessor still preserves the new tree in diagnostics.

The validator function can be injected by controlled programmatic unit tests.
No CLI flag or environment setting disables production validation. Production
callers use the full validator by default. Structural-only unit fixtures inject
a test validator; integration tests exercise the real validator before and after
publication in OS temporary directories.

## Boundaries

The project and its ancestors must be trusted and not concurrently modified by
uncooperative processes. Node's portable pathname APIs do not provide dirfd-based
no-follow traversal or a portable no-replace directory rename. An attacker able
to replace parent paths or mutate a reservation can still race checks and moves.
Symlink checks reject existing links but do not eliminate those races. Directory
mode 0700 restricts access on POSIX; Windows permissions depend on inherited ACLs.

Publication and recovery share an exclusive publication lock; stale locks require
manual inspection. Candidate reservation does not serialize publication against
the same staging source: one move wins and the other fails without recursive
cleanup. Publication's fixed backup, cleanup, diagnostic and active paths still
rely on the lock and trusted-directory assumption. Recovery refuses an existing
active runtime and preserves unresolved backups. Interrupted recovery retains
its existing structural checks before and after restoring a backup; it does not
perform a new full integrity validation. A backup represents the previously
active runtime, which may predate the current integrity or dependency policy.
Likewise, publication checks the previous runtime structurally rather than
requiring it to meet the new candidate's full validation contract.

No fsync durability guarantee is provided for power loss. No automated recovery
of incomplete candidates is attempted. Cross-device moves fail with staging
retained. Platform behavior is covered by portable API semantics; tests in this
change were run on macOS, not on Linux or Windows.
