# Opus Juris Support portal

The support owner's inbox for the Help panel inside Opus Juris: every firm's
conversations, the ones that need a reply first, and a reply box. One static
page, no build. Published to GitHub Pages from `main`.

- `index.html`, `app.js`: the page.
- `config.js`: the vendor project's public URL and anon key (public by design;
  the row policies decide who can read anything).
- Sign in with a support owner account on the vendor project. Who counts as
  an owner is the `support_owners` table (migration 196 in the app repo).

The app side lives in the app repo: `supabase/functions/support` (the store
the app writes through), `lib/support-remote.js` (the app's client) and
`lib/support-desk.js` (the Help desk itself).
