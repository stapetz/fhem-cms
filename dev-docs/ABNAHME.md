# MVP-Abnahmeprotokoll (S10)

Stand: 2026-10-31, Branch `dev`. Dieses Protokoll trennt ehrlich zwischen **geprüft** und **nicht geprüft**. Die Abnahme ist damit **nicht abgeschlossen**; offene Punkte stehen unten.

## Geprüft

| Bereich | Methode | Ergebnis |
|---|---|---|
| Modul: Validierung, Backups, Restore, Rebuild, Purge, ungültige Eingaben, Pfad-/Symlink-Schutz | `prove t/01_fhemcms.t` (Perl 5, temporärer `modpath`) | 97 Tests grün |
| Ungültige Daten: unbekannte Felder, doppelte IDs, Übergröße, Steuerzeichen, Pfadsyntax in Namen und Backupnamen, kein Base64 | Perl-Tests | abgewiesen |
| Neustart: Redefine legt fehlende Daten neu an, Daten bleiben bei `delete` erhalten | Perl-Tests | ok |
| XSS im Textbaustein | Lokaler Mock im Browser (Chromium/Playwright) mit Payloads | bleiben Text |
| Seiten anlegen, umbenennen, löschen, ungültiger Hash | Lokaler Mock | ok |
| Navigationseinträge (Beschriftung, Größe), Farb-Cleaner | Lokaler Mock (Chromium/Playwright) | ok |
| Navigations-Widget: vertikal/horizontal, Umsortieren, Verschieben im Layout-Modus, Veröffentlichen, Ansicht ohne Kopf | Lokaler Mock (Chromium/Playwright) | ok |
| Verbindungsabbruch: Stale-Anzeige, Erholung, Stopp nach `pagehide`, Neustart nach `pageshow` | Lokaler Mock mit erzwungenem HTTP 500 | ok |
| Backup-Dialog: Liste, Bestätigung, Wiederherstellung, Vor-Restore-Sicherung | Lokaler Mock | ok |
| Gerätesuche, Kanalsuche, Spaltenfilter, Sollwert setzen | Testinstanz `fhem.fritz.box:8083` (durch den Entwickler bestätigt) | ok |

## Nicht geprüft / offen

- **Berechtigungen:** Es gibt keine CMS-eigene Rechteprüfung; ein Test mit gesperrtem Benutzer (`allowed`, `basicAuth`) auf der Testinstanz fehlt. Die Testinstanz meldet „WEB is not password protected“.
- **Browser, Tastatur, Touch:** Nur Desktop-Chromium im Mock. Keine Phone-/Tablet-Referenzgeräte festgelegt, keine Safari-/Firefox-Läufe, keine Touch-Prüfung.
- **Performance und Serverlast:** Nicht gemessen (Ziele: 2 s bis bedienbar, 500 ms bis sichtbare Änderung bei 20 Widgets).
- **WebSocket-Live-Updates im Mock:** Der Mock unterstützt keinen WebSocket; auf der Testinstanz wurden Live-Updates früher geprüft, die neueste Version (S07 bis S09, Backup-Dialog, Purge) aber noch nicht.
- **Neueste Version auf der Testinstanz:** Seiten, Textbaustein, WYSIWYG-Editor, Bild-Upload (auch die POST-Größe von bis zu ca. 4,2 MB über FHEMWEB und nginx), Layout-Modus, Stale-Verhalten, `rebuild`, `purge`, Backup-Dialog und Restore-Auswahlliste sowie Entwurf/Veröffentlichen (S13) sind dort noch nicht getestet; im lokalen Mock lief Speichern als Entwurf, Veröffentlichen und Live-Ansicht. Der Editor wurde nur in Chromium getestet (Firefox und Safari offen); der Touch-Drag ist nicht auf echten Geräten geprüft.
- **FHEM-6.5-Kompatibilität** außerhalb der Testinstanz und die genaue FHEM-Version sind nicht festgehalten.

## Vorgeschlagener Testlauf auf der Testinstanz

1. Update einspielen, `sudo systemctl restart fhem`, `set CMS rebuild`.
2. Navigation über `⚙ Navigation` bearbeiten (Seite anlegen, umsortieren, Ausrichtung) und im Layout-Modus verschieben. Textbaustein mit Formatierung, Tabelle und hochgeladenem Bild (Position ändern, Bildgröße per Ziehpunkt, auch per Touch und Pfeiltasten), Thermostat hinzufügen. Layout-Modus: Kachel ziehen, Größe per Griff ändern, per Pfeiltasten verschieben und mit Umschalt+Pfeiltasten skalieren.
3. Backup-Dialog: Liste prüfen, älteren Stand wiederherstellen.
4. Netzwerk trennen (WLAN aus): Kachel muss „Veraltet“ zeigen und sich nach Rückkehr erholen.
5. Ein zweites FHEMWEB mit `allowed` und eingeschränktem Benutzer: Zugriff ohne Rechte muss mit Fehler enden.
6. Auf Phone und Tablet Bedienung, Touch und Tastatur prüfen; Gerät, Browser und Version hier eintragen.
7. Ladezeit (Navigation bis bedienbar) und Reading-Änderung bis Anzeige mit 20 Widgets messen und eintragen.
8. `purge` nur auf einem zusätzlichen Wegwerf-Device testen.
