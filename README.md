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
- **Audio clean-up** (on by default, done on-device): cuts low rumble, quiets background hiss between words, trims silence at the start and end, and evens out volume. Recording also uses the browser's built-in noise suppression.
- **Review** in three directions: *Listen* (audio → meaning), *Read* (romanization → meaning), *Recall* (English → say it). "Again" puts a card back into the session.
- **Deck** with search, tap-to-play and tap-to-edit.
- **Backup:** export / import the whole deck (audio included) as a JSON file.

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

- Spaced repetition scheduling (SM-2) instead of a simple shuffle
- Stronger noise removal (e.g. RNNoise via WebAssembly) for noisy recordings
- Bulk import from CSV + a folder of audio files
- Sync across devices (e.g. Supabase or Firebase storage)
- Auto-romanization (e.g. Jyutping via a dictionary like CC-Canto)
