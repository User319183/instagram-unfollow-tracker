# Instagram Unfollow Tracker

A Tampermonkey userscript that surfaces who unfollowed you on Instagram — powered by live GraphQL hash capture so it survives IG's backend rotations without manual updates.

**Author:** [Sathvik Sridar](https://github.com/User319183)  
**Built with:** [Oryvo](https://oryvo.ai) by [Covalence Systems Inc.](https://oryvo.ai)

---

## Features

- **API-first, no dialogs** — talks directly to Instagram's GraphQL endpoint like their own web app. No dialog popups. No simulated clicks.
- **Self-healing hash capture** — intercepts Instagram's own `fetch` calls to steal fresh query hashes in real time. If IG rotates their internal hashes, the script captures the new ones the moment their own client uses them. No manual updates needed.
- **Detects new unfollowers** — compares every scan against the previous one and flags anyone who dropped you.
- **Toast notifications** — unobtrusive on-screen alerts when someone unfollows you.
- **Works from any page** — feed, explore, DMs, profile. The `ds_user_id` cookie is all it needs.
- **Auto-scan** — scans once on load (with a 10-minute cooldown) and every 15 minutes while the tab is open.
- **Modern glass-panel UI** — backdrop-blur, smooth spring animations, dark stats cards, and a floating action button with a red badge count.

## Installation

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** for your browser.
2. Download [`instagram-unfollow-tracker.user.js`](instagram-unfollow-tracker.user.js).
3. Drag the file onto any browser tab. Tampermonkey will prompt to install.
4. Navigate to [instagram.com](https://www.instagram.com). The floating purple button appears in the bottom-right corner.

## How It Works

### Hash Capture

Instagram's GraphQL API uses opaque query hashes — short identifiers that map to server-side persisted queries. These rotate unpredictably when IG deploys.

The script hooks `window.fetch` at `document-start`, before Instagram's React bundle loads. Whenever IG's own code calls `/graphql/query` and the response contains `edge_follow` (following) or `edge_followed_by` (followers), the script clones the response, extracts the `query_hash` parameter, and saves it to `localStorage`. Subsequent scans use the captured hash.

If the captured hash ever goes stale (IG rotated it and the script hasn't captured the new one yet), the script falls back to a hardcoded hash and briefly flashes the followers/following dialog to trigger IG's own request — capturing the fresh hash for future use.

### Scan Flow

1. Read `ds_user_id` from cookies.
2. Call Instagram's GraphQL endpoint with `edge_follow` — paginate 50 at a time until exhausted.
3. Call Instagram's GraphQL endpoint with `edge_followed_by` — same.
4. Diff the two lists to compute "not following back."
5. Diff against the previous scan to detect new unfollowers.
6. Log, toast, update badge.

### Rate Limiting

Requests are paced at ~1 per second with jitter. Scans are capped at one every 10 minutes. This stays within the pattern of normal user scrolling — IG's mobile app fires these same queries at the same pace.

## Architecture

```
document-start hook
       │
       ▼
  intercept fetch() ─── capture query_hash ─── localStorage
       │
       ▼
  DOMContentLoaded ─── inject UI (glass panel + float button)
       │
       ▼
  auto-scan / manual scan
       │
       ▼
  GraphQL paginate ─── following[] + followers[]
       │
       ▼
  diff ─── not-following-back[], new-unfollowers[]
       │
       ▼
  render panel + toast + badge
```

## Security & Privacy

- All data stays in your browser's `localStorage`. Nothing is sent anywhere.
- The script only talks to `instagram.com` — the same domain you're already authenticated to.
- No credentials are extracted or transmitted. The `ds_user_id` cookie is read in-place and only used for API calls to Instagram.
- Open source. Read every line. There is no obfuscation.

## Limitations

- Requires Tampermonkey (or equivalent userscript manager).
- Instagram can rotate query hashes at any time. The live-capture mechanism handles this, but the hardcoded fallback may age out after 12-24 months without the script running.
- Large accounts (10,000+ following) may take longer due to pagination pacing. The timeout safety net is 50 pages.
- Not a mobile app. Browser-only.

## Disclaimer

This project is for educational purposes. It violates Instagram's Terms of Service. Use at your own risk. The authors are not responsible for account restrictions, bans, or any other consequences of using this software.

## Credits

**Author:** [Sathvik Sridar](https://github.com/User319183)

This tool was conceived, specified, iterated, and refined entirely through **[Oryvo](https://oryvo.ai)** — the desktop AI assistant built by **[Covalence Systems Inc.](https://oryvo.ai)**

From the initial dialog-scraping approach through the GraphQL API migration, the live hash-capture architecture, the glass-panel UI styling, the self-healing fallback chain, the line-by-line debugging of Tampermonkey injection quirks, and the open-source release packaging — every design decision, every architectural pivot, and every line of code was produced through Oryvo, operating on a real macOS desktop with screen capture, file system access, and live browser interaction.

Oryvo is not a chatbot. It is a desktop agent that sees your screen, clicks your UI, types into your apps, reads and writes your files, launches your programs, and builds software with you in real time — all from a simple chat interface.

If you want to build things like this, get Oryvo at **[oryvo.ai](https://oryvo.ai)**.

---

**Built with [Oryvo](https://oryvo.ai) by [Covalence Systems Inc.](https://oryvo.ai)** — *The desktop agent that builds.*
