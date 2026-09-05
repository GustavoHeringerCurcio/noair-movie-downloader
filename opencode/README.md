# opencode — session exports

Portable opencode session exports for this project, so a session can be resumed on another machine.

## Contents

- `sessions/2026-09-04_homepage-sections_ses_fa03b8c08ffe4tsUbAteNWSggM.json` — "TMDB sections for movie app homepage" (exported via `opencode export`).

## Resume on another machine

1. Clone / pull this repo.
2. Install opencode.
3. Import the session:

   ```sh
   opencode import opencode/sessions/<file>.json
   ```

4. Resume it:

   ```sh
   opencode -s <session-id>            # or:
   opencode -c                         # continues the most recent session
   ```

The session-id is in the filename and inside the JSON under `info.id`.

## Re-exporting

```sh
opencode export <session-id> > opencode/sessions/<date>_<topic>_<session-id>.json
```

> Note: exports contain full transcripts including tool/file contents. Verify before pushing if the repo is public.
