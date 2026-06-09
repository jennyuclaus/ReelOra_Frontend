# ReelOra – Deine Filmwelt. Deine Geschichten.

Eine vollständige Filmarchiv-App mit TMDB-Integration und Google Drive Sync.

## Schnellstart

1. `index.html` im Browser öffnen (oder auf einem Webserver hosten)
2. Unter **Einstellungen** → TMDB API Key eingeben
   - Kostenlos unter: https://www.themoviedb.org/settings/api
3. Optional: Google OAuth Client-ID für Drive-Sync einrichten (siehe unten)

## Features

- **Filme suchen & archivieren** – TMDB API, automatische Poster, Metadaten
- **Persönliche Bibliothek** – Raster- und Listenansicht, Filter, Suche, Sortierung
- **Bewertungen & Notizen** – 1–5 Sterne, persönliche Filmnotizen
- **Watchlists** – Beliebig viele Listen, Filme abhaken
- **Statistiken** – Filme pro Monat, Lieblingsgenres, Jahrzehnt-Auswertung, Top-Ratings
- **Kodi Import** – NFO/XML-Dateien hochladen oder Titel manuell eingeben
- **Google Drive Sync** – Automatisches Speichern der Bibliothek in Drive
- **Export/Import** – JSON-Backup jederzeit herunterladen und wiederherstellen

## Google Drive Einrichtung

### 1. Google Cloud Console
→ https://console.cloud.google.com

### 2. Neues Projekt erstellen
- Projektname: `ReelOra`

### 3. Google Drive API aktivieren
→ https://console.cloud.google.com/apis/library/drive.googleapis.com
- Auf "Aktivieren" klicken

### 4. OAuth-Zustimmungsbildschirm
→ https://console.cloud.google.com/apis/credentials/consent
- User Type: "Extern"
- App-Name: `ReelOra`
- Testnutzer: eigene Gmail-Adresse eintragen

### 5. OAuth 2.0 Client-ID erstellen
→ https://console.cloud.google.com/apis/credentials
- "+ Anmeldedaten erstellen" → "OAuth-Client-ID"
- Anwendungstyp: **Webanwendung**
- Autorisierte JavaScript-Quellen: URL deines Servers (z.B. `http://localhost:8080`)
- Client-ID kopieren

### 6. In ReelOra eintragen
- Einstellungen → Google Drive → Client-ID einfügen
- "Mit Google anmelden" klicken

## Lokaler Webserver (empfohlen)

Da die App fetch() verwendet, am besten über einen lokalen Server laufen lassen:

```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# PHP
php -S localhost:8080
```

Dann im Browser: http://localhost:8080

## Dateistruktur

```
reelora/
├── index.html          Hauptseite
├── css/
│   └── style.css       Alle Styles (Dark Mode, Gold-Theme)
├── js/
│   └── app.js          App-Logik (TMDB, Drive, Bibliothek)
└── README.md           Diese Datei
```

## Datenspeicherung

- **Lokal**: localStorage im Browser (sofort, kein Setup)
- **Cloud**: Google Drive als `reelora_library.json` in deinem Drive-Root

## Technologien

- Vanilla HTML/CSS/JavaScript (kein Framework, kein Build-Tool)
- TMDB API v3
- Google Drive API v3
- Google OAuth 2.0 (Implicit Flow)
- Google Fonts: Cinzel, Jost
