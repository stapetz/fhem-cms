# fhem-cms - Anwenderdokumentation

## Voraussetzungen

- FHEM 6.5 oder neuer (getestet mit Featurelevel 6.5, Perl 5.40).
- FHEMWEB muss laufen. Das CMS nutzt dessen Sitzung, Rechte und CSRF-Schutz; es gibt keine eigene Anmeldung.
- Ein aktueller Browser mit ES-Modulen, Web Components und `<dialog>`.

## Installation

```text
update add https://raw.githubusercontent.com/stapetz/fhem-cms/main/controls_fhem-cms.txt
update all https://raw.githubusercontent.com/stapetz/fhem-cms/main/controls_fhem-cms.txt
```

Danach FHEM neu starten (`shutdown restart` oder `sudo systemctl restart fhem`), damit das Modul geladen wird. Anschließend:

```text
define CMS fhemcms
```

Das Device erscheint im Raum `FHEM CMS` mit dem Link `CMS starten`. Alternativ: `get CMS url`.

## Sicherheit: FHEMWEB absichern

Das CMS liest und schreibt über FHEMWEB. Ist FHEMWEB nicht abgesichert (FHEM meldet beim Start „WEB is not password protected“), kann jeder im Netz die CMS-Konfiguration ändern und Sollwerte setzen. Bitte vor dem produktiven Einsatz ein `allowed`-Device anlegen:

```text
define allowed allowed
attr allowed validFor WEB
attr allowed basicAuth <base64 von benutzer:passwort>
```

Das CMS speichert keine Zugangsdaten und erlaubt keine fremden Origins (kein CORS).

## Bedienung

- **Seiten:** Navigation oben, `+ Seite`, `Seite umbenennen`, `Seite löschen` (die letzte Seite kann nicht gelöscht werden). Seiten sind per Link `#/<id>` aufrufbar.
- **Widgets:** `+ Widget` fügt eine Thermostat-Kachel oder einen Textbaustein hinzu. Das Zahnrad an der Kachel öffnet die Konfiguration. Beim Thermostat wird das Hauptdevice gewählt; Kanäle werden automatisch durchsucht. Der Dialog filtert pro Spalte (Device, Alias, Typ, Raum).
- **Textbaustein:** Markdown (Überschriften, Listen, Hervorhebungen, Links). HTML wird nie ausgeführt; Links sind nur `http(s)` oder relativ erlaubt.
- **Backups:** Jede Speicherung legt ein Backup an. `Backups` zeigt die Liste; ein Klick stellt den Stand nach Bestätigung wieder her. Der aktuelle Stand wird vorher selbst gesichert.
- **Verbindungsabbruch:** Die Kachel zeigt die letzten Werte gedämpft mit „Veraltet seit …“, der Regler ist gesperrt. Nach Wiederherstellung der Verbindung wird sofort neu gelesen.

## Dateien und Daten

| Pfad | Inhalt |
|---|---|
| `<modpath>/www/fhem-cms/` | Gemeinsame Frontend-Dateien (werden durch `update` ersetzt) |
| `<modpath>/www/fhem-cms/<Device>/index.html` | Generierte Startseite (nicht bearbeiten) |
| `<modpath>/fhem-cms-data/<Device>/config.json` | Konfiguration inkl. Backups (`config.json.<Zeit>.bak`) |

`fhem-cms-data` liegt außerhalb von `www` und wird nicht ausgeliefert. Das Betriebssystem-Konto von FHEM braucht dort Schreibrechte; empfohlen sind Verzeichnisrechte 0750 und Dateirechte 0640.

## Befehle

| Befehl | Wirkung |
|---|---|
| `get <CMS> url` | Pfad der Startseite |
| `get <CMS> config` | Konfiguration als JSON |
| `get <CMS> backups` | Liste der Backups |
| `set <CMS> config <Base64-JSON>` | Konfiguration speichern (wird validiert) |
| `set <CMS> restore <Backupname>` | Backup wiederherstellen |
| `set <CMS> rebuild` | Startseite neu erzeugen (nach Updates der Frontend-Dateien) |
| `set <CMS> purge <CMS>` | Daten und Startseite endgültig löschen, danach `delete <CMS>` |

`delete <CMS>` allein lässt Daten und Startseite bewusst bestehen.

## Fehlerbehebung

| Symptom | Ursache und Abhilfe |
|---|---|
| Seite zeigt altes Verhalten nach Update | `set <CMS> rebuild` und Browser neu laden. Steht ein Proxy mit Cache davor, diesen umgehen oder leeren. |
| „Konfiguration konnte nicht geladen werden“ | `get <CMS> config` in FHEM prüfen; Rechte auf `fhem-cms-data`; Logfile ansehen. |
| „Speichern fehlgeschlagen: …“ | Meldung nennt den Validierungsfehler (unbekanntes Feld, doppelte ID, zu lang). |
| Kachel „Veraltet“ | Verbindung oder Rechte fehlen (HTTP 401/403/5xx). FHEMWEB-Anmeldung und `allowed` prüfen. |
| Live-Werte kommen nur alle 30 s | WebSocket-Inform ist nicht erreichbar (Proxy ohne WebSocket-Weiterleitung); das CMS fällt auf Polling zurück. |
| `update` entfernt gelöschte Dateien nicht | Bekanntes FHEM-Verhalten; veraltete Dateien unter `www/fhem-cms/` bei Bedarf von Hand löschen. |
| Startseite nicht neu erzeugt | Eine Datei ohne Modul-Marker wird nie überschrieben. Datei entfernen und `set <CMS> rebuild` ausführen. |
