# Audio Flashcards

A small web app for language-learning flashcards. Each card holds:

- **Audio** of the word, phrase or sentence (upload a file or record in the browser)
- **Written form** in the target language (e.g. 你好)
- **Romanization** (optional, e.g. Jyutping `nei5 hou2`)
- **English meaning**
- **Notes** (optional)

Works for any language: type a language name per card (Cantonese, Mauritian Creole, …) and filter by it.

## Features

- Add, edit, delete cards; search and filter the deck by language
- Review mode with three directions: audio → meaning, written → meaning, English → written
- "Again" puts a card back into the current session; "Got it" moves on
- Export / import the whole deck (audio included) as a JSON file for backup or moving between devices

All data is stored locally in your browser (IndexedDB). There is no server or account.

## Running

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Recording needs `localhost` or HTTPS. It can be hosted as-is on GitHub Pages.

## Ideas for later

- Spaced repetition scheduling (SM-2) instead of a simple shuffle
- Bulk import from CSV + a folder of audio files
- Sync across devices (e.g. Supabase or Firebase storage)
- Auto-romanization (e.g. Jyutping via a dictionary like CC-Canto)
