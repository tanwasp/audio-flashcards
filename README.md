# Audio Flashcards

A small web app for language-learning flashcards, built for phones. Each card holds:

- **Audio** of the word, phrase or sentence (record in the app or upload a file)
- **Romanization** (how it sounds)
- **English meaning**
- **Written form** in the language's own script (optional)
- **Notes** (optional)

You need at least the romanization or the written form. Works for any language: each card has a language, and the app remembers the last one you used.

## Features

- **Fast entry:** after saving, the form stays open with the language filled in, ready for the next card. The card you're writing (including its recording) is kept as a draft, so it survives the app being closed.
- **Audio editor:** see the waveform, tap anywhere to play from there, and trim the clip by dragging two handles. A live level meter shows while recording.
- **Audio clean-up** (on by default, done on-device): cuts low rumble, quiets background hiss between words, trims silence at the start and end, and evens out volume. Recording also uses the browser's built-in noise suppression.
- **Spaced repetition:** a simplified SM-2. Answer *Again*, *Good* or *Easy*; each button shows when the card will come back. The Today screen shows what's due plus a daily allowance of new cards. *Practice all* runs through everything without changing the schedule.
- **Review** in three directions: *Listen* (audio → meaning), *Read* (romanization → meaning), *Recall* (English → say it). "Again" puts a card back into the session.
- **Streaks and goals:** hit your daily review goal to extend your streak. XP and levels, badges, an in-session combo counter, and a 17-week activity heatmap on the Progress screen.
- **Daily reminder:** if you haven't hit your goal by the chosen hour, you get a notification. This uses Periodic Background Sync, so it only works in Chrome/Edge with the app installed. Safari (iPhone) and Firefox can't schedule notifications without a push server.
- **Feel:** haptics (Android vibration; on iPhone, Safari 18+ ticks via a hidden switch), small synthesized sounds, a mascot, and a celebration when a card is saved. Both can be turned off in Progress → Settings.
- **Deck** with search, language filter, tap-to-play, tap-to-edit and each card's next review date.
- **Backup:** export / import the whole deck (audio, progress and settings included) as a JSON file.

All data is stored locally on your device (IndexedDB). There is no server or account. Export regularly to keep a backup.

## Installing on your phone

It's a PWA: install it and it opens full-screen like an app and works offline.

- **iPhone (Safari):** open the site, tap Share → **Add to Home Screen**.
- **Android (Chrome):** open the site, tap ⋮ → **Install app**.

On iPhone, install it rather than using it in a Safari tab. Safari can clear a website's data after about 7 days of not visiting, but installed apps are exempt.

## Running

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Recording and offline mode need `localhost` or HTTPS. Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`.

When you change the app's files, bump `CACHE` in `sw.js` so old cached copies are cleared.

## Ideas for later

- Stronger noise removal (e.g. RNNoise via WebAssembly) for noisy recordings
- Bulk import from CSV + a folder of audio files
- Accounts and sync across devices (e.g. Supabase auth + storage), which would also allow real push reminders on iPhone
- Auto-romanization (e.g. Jyutping via a dictionary like CC-Canto)

The Nunito font in `fonts/` is from Google Fonts, under the SIL Open Font License.
