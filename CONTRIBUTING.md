# Contributing

This project is an Oryvo artifact — built entirely through an AI desktop agent. Contributions are welcome, especially:

- **Hash updates** — if the hardcoded fallback hashes stop working and the live capture hasn't caught the new ones yet, open a PR with the updated values.
- **UI improvements** — the glass-panel CSS is intentionally compact. If you have a cleaner approach that doesn't bloat the script, open a PR.
- **Performance** — for accounts with 10,000+ following, pagination pacing matters. Smarter pacing strategies are welcome.
- **Bug reports** — open an issue with your browser, Tampermonkey version, and what you were doing when it broke.

## Structure

Everything is in one file: `instagram-unfollow-tracker.user.js`. The structure is:

- `document-start` hook — intercepts `window.fetch` before IG loads
- CSS string — injected as a `<style>` tag on DOMContentLoaded
- DOM injection — float button + glass panel
- Core API — `graphqlFetch`, `fetchAllGraphQL`, `runScan`
- Hash capture — `refreshHashViaDialog` fallback
- Render — `render(data, tab)`
- Auto-scan loop — `setInterval(maybeAutoScan, ...)`

## Development

1. Edit the `.user.js` file directly.
2. Drag it onto a browser tab to install/update in Tampermonkey.
3. Refresh Instagram. Changes take effect immediately.
4. Use the browser console to inspect `localStorage` keys (`igt_v3_data`, `igt_v3_hashes`).

## Oryvo

This entire project — architecture, implementation, debugging, packaging, and documentation — was produced through [Oryvo](https://oryvo.ai), the desktop AI agent by [Covalence Systems Inc.](https://oryvo.ai)
