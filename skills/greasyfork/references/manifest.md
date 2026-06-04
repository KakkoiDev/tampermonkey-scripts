# greasyfork.json manifest

Lives at the root of your userscript repo. Maps each local file to its Greasy Fork listing.

```json
{
  "locale": "en",
  "scripts": [
    { "file": "my-script.user.js", "id": "513815", "visibility": "public", "name": "My Script" },
    { "file": "wip.user.js", "id": null, "visibility": "unlisted", "name": "Work in progress" }
  ]
}
```

## Fields
- `file` - path to the `.user.js`, relative to the repo root.
- `id` - Greasy Fork numeric id as a **string**, or `null` until published. `register.mjs` writes it back after creating the listing.
- `visibility` - `public` | `unlisted` | `library`. `register.mjs` maps this to the `script_type` radio (public=1, unlisted=2, library=3).
- `name` - human label (for your reference).
- `locale` (top-level, optional) - API locale segment, default `en`.

## Raw URLs are derived, not stored
The tools compute the GitHub raw URL from git, so the manifest is portable across forks:

```
owner/repo  <-  git remote get-url origin
branch      <-  git rev-parse --abbrev-ref HEAD
rawUrl      =   https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<file>
```

Don't hardcode owner/repo/branch anywhere. If your default branch isn't the one you publish from, switch to it before running the tools (they read the current branch).
