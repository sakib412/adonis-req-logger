# Releasing — maintainer playbook

How changes flow into releases across the package's support lines. The
versioning model itself is defined in
[ARCHITECTURE.md → Versioning & support policy](./ARCHITECTURE.md#versioning--support-policy);
this document is the *procedure*.

## The lines

| Line | AdonisJS | Branch | npm dist-tag | GitHub release flag |
| ---- | -------- | ------ | ------------ | ------------------- |
| 7.x  | v7       | `main` | `latest`     | marked **Latest**   |
| 5.x  | v5       | `v5.x` | `adonis5`    | `--latest=false`    |

Within a line, versions are normal semver for the package's own changes
(features → minor, fixes → patch). The major never changes within a line —
it tracks the AdonisJS major.

Canonical docs (this file, ARCHITECTURE.md) live on `main`. The `v5.x`
branch carries its own README and implementation, nothing else is
authoritative there.

## Where does my change land first?

**Always `main`, except when the bug only exists on an old line.**

### New feature

1. Build it on `main` against the current AdonisJS major. Update the
   package README; update ARCHITECTURE.md if a locked decision moves.
2. Verify with the demo app (`apps/backend`) — drive the affected behavior,
   don't stop at typecheck.
3. If the feature is **portable to the v5 API surface** (see the exclusion
   list below), add the `backport:v5.x` label to the PR/commit. It joins the
   queue for the next 5.x release — you don't port it now.
4. Release `main` when ready (see checklist): **minor** bump.

### Bug / security fix

1. Fix on `main` first, with the same verification bar.
2. If the affected code exists on the v5 line, label it `backport:v5.x`.
3. Release: **patch** bump on `main` when warranted. Security fixes ship
   immediately on every affected line — don't wait for a batch.

### Hotfix that only affects an old line

A bug in v5-only code (the before-hook timing, the middleware, the
`instructions.md` flow) has nothing to fix on `main`:

1. Fix directly on `v5.x`. No label — the label marks `main` commits that
   need porting, and this one never touches `main`.
2. Verify with the v5 demo app on that branch.
3. Release the line: **patch** bump.

### What is never back-ported

Changes tied to APIs the v5 line lacks: ESM-only code,
`http:request_completed`, named loggers (`config/logger.ts`), worker-thread
transports (`adonis-req-logger/pretty`), assembler codemods. When a labelled
change turns out to be unportable, drop the label and note why on the PR.

## Releasing the 7.x line (`main` → `latest`)

```sh
git checkout main && git pull && pnpm install
cd packages/adonis-req-logger
pnpm typecheck && pnpm build
npm pack --dry-run                 # eyeball the tarball contents
npm version minor                  # or patch — updates package.json
git commit -am "chore: release 7.x.y" && git push
npm publish                        # no publishConfig here → lands on `latest`
npm dist-tag ls adonis-req-logger  # verify
git tag v7.x.y && git push origin v7.x.y
gh release create v7.x.y --latest --title "v7.x.y" --notes "..."
```

## Releasing the 5.x line (`v5.x` → `adonis5`)

1. **Drain the back-port queue first.** Find labelled commits that haven't
   been picked yet, oldest first, and cherry-pick with provenance:

   ```sh
   gh pr list --repo sakib412/adonis-req-logger \
     --label backport:v5.x --state merged      # or search commits by label
   git checkout v5.x && git pull
   git cherry-pick -x <sha>...                 # resolve to v5 APIs as needed
   ```

   A pick that needs real adaptation is fine — adapt in the cherry-pick
   commit itself; `-x` keeps the pointer to the original.

2. **Verify on the branch** — the v5 demo app is the line's test suite:

   ```sh
   pnpm install && cd packages/adonis-req-logger
   pnpm typecheck && pnpm build
   cd ../../apps/backend && pnpm typecheck
   node ace serve   # hit /, /users/42, /slow, /error, /health, /nope
   ```

3. **Publish** — `publishConfig.tag: adonis5` is baked into the package, so
   even a bare `npm publish` cannot take `latest`:

   ```sh
   cd packages/adonis-req-logger
   npm version patch                # or minor for back-ported features
   git commit -am "chore: release 5.x.y" && git push
   npm publish
   npm dist-tag ls adonis-req-logger   # expect latest: 7.…, adonis5: 5.…
   git tag v5.x.y && git push origin v5.x.y
   gh release create v5.x.y --latest=false --title "v5.x.y" --notes "..."
   ```

`--latest=false` matters: GitHub's **Latest** badge must stay on the newest
7.x release, not the most recently published one.

## When a new AdonisJS major ships (v8, …)

1. Cut `v7.x` from `main`; it becomes a maintenance line
   (dist-tag `adonis7`, add `publishConfig.tag` on that branch).
2. `main` moves to the new major: package major 8, still `latest`.
3. Add the line to the version tables (both READMEs) and create a
   `backport:v7.x` label.
4. Old lines stay in maintenance until their AdonisJS major is genuinely
   dead; mark the table row Maintenance/EOL when that happens.

## Future automation

This flow is deliberately manual while the repo has no CI (see the
[CI decision](https://github.com/sakib412/adonis-req-logger/issues/11)).
When the 7.x CI effort lands, the intended upgrade is a changesets-based
pipeline (as used in adonis-mongoose: changesets on `main` → version PR →
publish + GitHub release on merge), extended with the `v5.x` branch as a
second release target. Until then: the checklists above are the release
system.
