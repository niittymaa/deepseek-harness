# CLI chat response repair handoff

Commit: f643e5f3e6054a4c096759ef012923f8c6f333d9 (local master; not pushed).

Implemented: empty successful CLI output now emits CLI_EMPTY_OUTPUT, preserving stderr diagnostics. Failed CLI calls retain stdout diagnostics if stderr is empty. Fixed plugin config catalog discovery and refreshed generated references. Existing unrelated ui-primitives edits remain unstaged.

Verified: owning tests 22 passed; agent request-error tests passed in the earlier combined 25-test run; owning oxlint passed; final build passed all 10 gates, including aggregate checks. Real agy through shipped headless profile with temporary command overlay returned HELLO. Direct agy also produced a quota error on a different request, so quota availability is not assumed.

Outstanding acceptance: reproduce and inspect success and quota failure in actual chat UI; add/update the required recorded-session regression for this adapter. Browser inventory is empty and native control repeatedly fails with native pipe unavailable (OS error 2). No UI acceptance has been claimed.

Other checks: doc-sync 41/43 passed. Remaining failures are repository-reference matching in unchanged python/sdk/uv.lock and EPERM creating a file symlink in scripts/project-doc-site.spec.ts. Existing error-finish session replay fails on escaped Windows runtime cwd versus {{cwd}}. No expected fixtures or normalizers were weakened. Push remains pending these checks/acceptance decisions.

Temporary overlays: success.yml, quota.yml, agy.yml in this directory. No credentials or test artifacts were committed.

Next bounded task: restore browser-control connection, launch an isolated web profile with pin-browse-picker overlay and external-cli deterministic fixture, and verify rendered success/error messages before completing snapshot acceptance and publishing.

Snapshot continuation: .tmp/cli-response-check/snapshot-candidate contains a candidate recorded-session regression exercising the real external CLI adapter (replay adapter disabled). Refresh passed. Replay failed solely on JSON-escaped Windows cwd values retaining the generated temporary directory. Candidate is deliberately not in the committed snapshot corpus. Existing error-finish exhibits the same issue. Need a repository-policy-compliant portable fixture strategy before publishing. No normalizer or expected-output check was weakened.

Published continuation: origin/master is now 4c94d1a124c75e6ffdcff483c75bae9d7ec7698a. Includes prior CLI repair, all UI changes, persistent headless integration tests, and external-cli-empty-output Session snapshot. New snapshot refresh, keyless replay, and header-pin check passed. Snapshot composition omits working-directory context and its dependent tool plugins to isolate CLI response settlement without volatile Windows path strings; no normalizers were changed. Push typecheck passed all five gates. Only .tmp remains untracked.

UI acceptance remains blocked: latest cua.getState returned no browsers/apps and native pipe unavailable OS error 2. Restore the computer/browser connection, then test real chat response and rendered CLI_EMPTY_OUTPUT diagnostic using an isolated home and the shipped Web profile. Do not describe headless/session verification as visual acceptance. Earlier broad doc-sync has two unrelated baseline failures and the pre-existing error-finish snapshot retains its Windows cwd mismatch.
