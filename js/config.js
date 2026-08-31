// ============================================================
//  ReelOra – config.js
// ============================================================
// Zentrale Konfiguration. Die Google Client-ID ist KEIN Geheimnis
// (sie steht in jeder Web-App sichtbar im Quellcode / in Netzwerk-
// Requests) und darf deshalb bedenkenlos im Repo liegen. Geschützt
// wird der Zugriff stattdessen über "Autorisierte JavaScript-Quellen"
// in der Google Cloud Console – dort muss die jeweilige Domain der
// App eingetragen sein, sonst lehnt Google den Login ab.
//
// Gleiche Client-ID wie bei den anderen Web-Apps (z.B. KeepersLog) –
// kein eigenes Google-Cloud-Projekt für ReelOra nötig.

const REELORA_CONFIG = {
  GOOGLE_CLIENT_ID: '643005354958-lihg7hd4jfqu6jahcu2ac57hnivuvrsv.apps.googleusercontent.com',
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',
};
