# Agent instructions

This repository is the source of truth for WorldSat Monitor. Work against the
selected branch and follow existing CI and release policies. Do not substitute
generated mock UI/backend code for actual repository functionality.

## ChatGPT Sites work

When the task is to **build, rebuild, or publish the WorldSat website using
Sites**, read [docs/sites-deployment.md](docs/sites-deployment.md) first.

- Use `scripts/sites-rebuild.sh main` to fetch a clean, current approved
  `main` source snapshot and run deterministic frontend validation.
- If an existing deployment's exact Git revision is requested, set
  `WORLDSAT_SOURCE_SHA` to its recorded full SHA before running the script.
- Operate from the returned `sites_project_dir`; verify and report its Git
  SHA, lockfile digest, CI status and Sites saved version.
- Do not publish from a stale checkout, a branch with uncommitted changes, or
  a ChatGPT-generated copy that has not been committed to GitHub.
- Preserve the existing Sites linkage at `frontend/.openai/hosting.json`;
  inspect before attempting to provision another Site.
- Sites does not run the repo's Python/PostgreSQL Docker Compose stack. Check
  API routing, map resources and public API authorization before publishing.
- Save a Sites version for validation before deployment, and report the final
  public URL only after successful deployment.
- Fix build and browser issues in a repository branch and PR first; do not
  create untracked live-site-only patches.
