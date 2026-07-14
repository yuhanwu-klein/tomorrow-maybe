# Tomorrow, Maybe — Build Plan

A delayed communication app: one letter per day, opens in 24h, system emails it back at a random future time (days to years).

## Visual direction
- **Homepage**: sky-blue background, white envelopes of varied sizes drifting upward (parallax near/far). Centered translucent sign-up card in the monospaced "membership form" style from image 1.
- **Writing view (image 3)**: a single open envelope + letter sheet centered, pen-shaped cursor, faint blurred grid of previously-written letter squares behind. Three prompts: 🌱 Today's Goal · 💭 Today's Thought · ✨ Advice to Future Self.
- **Profile (image 2)**: stacked folder tabs labeled by month, grouped per year. Search bar (YYYY-MM-DD) jumps directly to that letter. Each letter square is a user-chosen color (color picker) with date label.
- **Community view (image 4)**: envelopes drift right-to-left with usernames underneath. Click a user → their folder grid → click an unlocked letter → read + react with emoji only.
- Two persistent top buttons: **My Archive** / **Community**.

## Core rules
- One letter/day per user (enforced server-side by date).
- Letter sealed for 24h — invisible to everyone (author included) until then.
- After 24h: public, reactable with emoji only (no text comments per spec; original brief mentioned "comment emoji" after 14h — I'll use 24h to match the unlock rule, emoji-only reactions).
- System schedules one email delivery per letter at a random future timestamp (1 day → 10 years out).

## Tech / backend (Lovable Cloud)
- **Auth**: email/password + Google.
- **Tables**:
  - `profiles` (id, username, created_at)
  - `letters` (id, user_id, date [unique per user], goal, thought, advice, color, unlock_at, deliver_at, created_at)
  - `reactions` (id, letter_id, user_id, emoji) — unique (letter, user, emoji)
- RLS: users insert their own letters; SELECT allowed when `unlock_at <= now()`; reactions insert by authenticated, select public.
- **Email**: Lovable Cloud email infra + pg_cron job every minute scanning letters where `deliver_at <= now() AND delivered_at IS NULL`, enqueue email with the letter content, mark delivered.
- **Random delivery time**: at insert, `deliver_at = now() + random_interval(1 day .. 10 years)`.

## Routes
- `/` — landing + signup/login (floating envelopes)
- `/write` — today's letter composer (redirects to today's sealed view if already written)
- `/archive` — user's folder grid + search
- `/letter/$id` — open letter (own or others, if unlocked)
- `/community` — drifting envelopes of recent unlocked letters by user
- `/u/$username` — that user's public folder grid

## Build order
1. Enable Lovable Cloud, schema + RLS + grants, auth (email + Google).
2. Design system in `src/styles.css`: sky-blue palette, monospace + serif pairing, envelope/letter/folder component variants, color-picker palette tokens.
3. Floating-envelope background component (SVG envelopes, CSS keyframe drift).
4. Landing page with signup card.
5. Write page: envelope-open animation, pen cursor, three prompt fields, color picker, blurred prior-letters backdrop.
6. Archive page: year/month folder tabs, colored date squares, search.
7. Letter detail page + emoji reactions.
8. Community page + public user archive.
9. Email scheduling: server function on letter create computes `deliver_at`; pg_cron + queue processor sends email when due.
10. Sitemap/robots, meta tags per route.

## Open questions (will assume defaults unless you say otherwise)
- Reaction set: ❤️ 🌱 ✨ 💭 🫶 😮 — OK?
- Random range: 1 day to 10 years, uniform — OK?
- Community feed shows only letters from the last N days of unlocks, or all-time random sample? Default: most recent 50 unlocked.
