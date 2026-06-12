# MusigPlayer – Setup Guide

## Stack
Next.js 14 · NextAuth.js · Microsoft Graph API · Google Drive API · IndexedDB · PWA

## Environment Variables (Vercel)

| Variable | Wert |
|---|---|
| `AZURE_CLIENT_ID` | App-ID aus Azure Portal |
| `AZURE_CLIENT_SECRET` | Secret aus Azure Portal |
| `GOOGLE_CLIENT_ID` | Optional – Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Optional – Google Cloud Console |
| `NEXTAUTH_SECRET` | Zufallsstring (min. 32 Zeichen) |
| `NEXTAUTH_URL` | `https://DEINE-URL.vercel.app` |

## OneDrive Setup (Azure Portal)
1. portal.azure.com → App-Registrierungen → Neue Registrierung
2. Kontotypen: Alle Microsoft-Konten
3. Manifest → `requestedAccessTokenVersion: 2`
4. Umleitungs-URIs: `https://DEINE-URL.vercel.app/api/auth/callback/azure-ad`
5. API-Berechtigungen: Files.Read, Files.ReadWrite, offline_access, openid, email, profile
6. Neues Client-Secret → Wert kopieren

## Musik-Ordner
Musik liegt in OneDrive unter `MeineMusik/` – Unterordner werden automatisch erkannt.

## PWA installieren
- Android Chrome: Menü → App installieren
- iOS Safari: Teilen → Zum Home-Bildschirm
- Desktop Chrome: Adressleiste → Install-Icon
