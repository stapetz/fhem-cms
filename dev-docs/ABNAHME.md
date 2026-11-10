# MVP-Abnahmeprotokoll (S10)

## Entwicklungsstand 1.3.0-dev: LinkWidget (#123)

Lokale Prüfung am 10.11.2026, noch keine Geräteabnahme oder `main`-Freigabe:

- `perl -c FHEM/01_FHEMCMS.pm` und `prove -l t/*.t`: erfolgreich
  (487 Assertions einschließlich Gerätehilfe).
- `node --test t/*.test.js`: 104 Tests erfolgreich, keine übersprungen.
- `node scripts/build-fcui.mjs --check` und `git diff --check`: erfolgreich.
- `t/48_link_widget.test.js`: positive/negative Frontend-/Perl-Parität für
  Linkziele, Textpositionen, Unicode-Grenzen, Bildpfade und 1–200 Kacheln;
  unbekannte Felder, Überlappungen und Rasterüberläufe werden abgewiesen.
- Chromium: `t/49_link_widget.html`, 93 Prüfungen einschließlich echter
  Pointerbewegung um vier Spalten, Skalierung um zwei Spalten/eine Zeile,
  Speichern/Wiederöffnen, Abbrechen, Upload-/Schreibfehler und Bereinigung.
- `t/22_schema5_widget_panel.test.js`: Anlage über Typauswahl mit gültigem
  Standardlink, vollständiger Perl-Entwurfs-Write/Readback und unveränderte
  Live-Datei. Navigationstest: interne Referenzen folgen Seiten-ID-Änderungen,
  das Löschen einer verlinkten Zielseite bleibt ohne Schreibzugriff gesperrt.

Zur Geräteabnahme: reale interne Ziele, Medien-Upload, Popupregeln sowie
Touch und Safari mit dem üblichen Entwurf-/Veröffentlichungsablauf prüfen.
Linkkacheln werden im Widgetdialog angeordnet, nicht direkt im Seiteneditor.
Popup-Widgetgruppen aus #31 gehören nicht zum Umfang.

## Release 1.2.0: freigegebener Umfang

Am 10.11.2026 hat der Entwickler nach den heutigen Korrekturen ausdrücklich
Aufräumen von Issues/Kanban, Dokumentationspflege und einen neuen Release auf
`main` beauftragt. Diese Freigabe umfasst #105–#119. Sie ersetzt keine
vollständige Prüfung aller Browser, Geräte oder der älteren offenen
MVP-/Refactoringanforderungen. Releaseverfolgung: #120.

Alle 15 Umsetzungsthemen waren bereits als Issues und Projektkarten vorhanden.
Die Releasefreigabe wird bei ihnen dokumentiert, `needs-test` entfernt und
der Status vor Veröffentlichung auf `Ready to publish` gesetzt. #104 ist ein
bereits geschlossenes Einheiten-/Schreibweisenthema vom Vortag und wird ohne
doppeltes Issue ins Projekt nachgetragen. Der gewünschte kWh-Hinweis steht in
der README; vorhandene Einheiten werden nicht automatisch umgerechnet.
#96 (HMCCUCHN-Auswahl bei neuen Thermostaten) und andere ältere offene Aufgaben
sind ausdrücklich nicht Bestandteil dieser Gerätewechselkorrektur.

Basis ist der stabile Release 1.1.0. Neue rückwärtskompatible Funktionen
ergeben nach SemVer 1.2.0, unabhängig von den zwischenzeitlichen
Entwicklungsversionsnummern. Der Release-Branch startet auf `main`; nur die
folgenden issuebezogenen Commits werden in dieser Reihenfolge übernommen.
Generierte Controls-Commits, reine dev-Versionsfortschreibungen und
KI-Anweisungen gehören nicht zur Auswahl:

| Issue | Entwicklungscommits | Umfang |
|---|---|---|
| #105 | `79fc3ad` | Thermostat-Gerätewechsel und erneutes Lesen der Bindungen |
| #106 | `d944cfc`, `9aca214`, `306dfad` | Fenster-/Zoomskalierung und Browserregression |
| #107 | `3e51283`, `747d34a` | Globale Titelausrichtung und Änderungshistorie |
| #108 | `34c3c61` | Widget-Inhalte an verfügbare Innenfläche anpassen |
| #109 | `a9412a8` | Zoomfähiges präzises Editorraster |
| #110 | `eab3568` | Standardsymbole und optionale Beschriftung |
| #111 | `4480184`, `6a1c976`, `5898afc`, `d197923` | Resize-Griff, Navigation und seitenübergreifender Reflow |
| #112 | `47ab489` | Vertikale Platzprüfung und Ausrichtungswechsel |
| #113 | `a20d12f`, `8019ba5`, `13c75eb`, `b584617` | Werkzeuge bei Hover/Fokus und Touchregression |
| #114 | `3f914f8` | Safari-Auswahl beim Formatieren erhalten |
| #115 | `9c21af0`, `8f29ff3` | Automatisches Anordnen mit stabiler Leserichtung |
| #116 | `6e212bf` | Einheiten für Text-Readings |
| #117 | `8cb5ae4` | SolarFlow-Titelbereich freihalten |
| #118 | `7bbd5a2` | Gemeinsame freie Einheitenfelder mit Vorschlägen |
| #119 | `cb85b80` | Gemeinsame Rastergeometrie in Editor und Ansicht |

Die issuebezogenen Prüfungen und vollständige CI auf `dev` waren erfolgreich.
Für #119 bestehen 850 Geometrieprüfungen in Chromium und WebKit 17.4 über alle
fünf Rasterdichten; das ursprüngliche CSS reproduziert die Abweichung in WebKit.
Echter Browserzoom bei 80/100/125/200 Prozent sowie Pointer-Drag/Resize sind
ebenfalls geprüft. Die isolierte Releaseprüfung wiederholt Perl-Syntax,
Perl-/JavaScript-Tests, Buildvergleich und vollständigen Diffabgleich.
Ein stabiler FHEM-Update-Stand ist erst nach erfolgreichem `main`-Push und
abgeschlossenem Controls-Workflow verfügbar. Erst dann werden die tatsächlich
enthaltenen Issues geschlossen und nach `Done` überführt.

Ergebnis der isolierten Releaseprüfung:

- `perl -c FHEM/01_FHEMCMS.pm`: Syntax korrekt.
- `prove t/*.t`: 465 Prüfungen erfolgreich.
- `node --test t/*.test.js`: 102 Tests erfolgreich, keine übersprungen.
- `node scripts/build-fcui.mjs --check`: reproduzierbarer Build erfolgreich,
  mit identischen Abhängigkeiten aus dem unveränderten Lockfile.
- `git diff --check`: keine Patchfehler.
- Vollständiger Inhaltsabgleich gegen den freigegebenen `dev`-Stand:
  vor Release-Metadaten ausschließlich die generierte Controls-Datei verschieden;
  danach zusätzlich stabile Modulversion und dieses Prüfprotokoll.
- Keine Änderungen unter `.github/` im Release-Diff; die beiden fremden lokalen
  Änderungen an KI-Anweisungen und Backendtest wurden nicht übernommen.

## Release 1.1.0: bestätigter Umfang

Am 09.11.2026 hat der Entwickler den aktuellen Stand als abgenommen bestätigt
und die Veröffentlichung der Issues #97–#103 ausdrücklich nach `main`
freigegeben. Ältere offene MVP-/Refactoringthemen sind nicht Teil dieser
Abnahme und werden dadurch weder geschlossen noch als geprüft ausgewiesen.

Der Release-Branch wurde von `main` 1.0.0 erstellt. Ausschließlich folgende
issuebezogenen Entwicklungscommits wurden übernommen, ohne generierte
Controls-Commits oder die reine dev-Versionsfortschreibung:

| Issue | Entwicklungscommits | Umfang |
|---|---|---|
| #97 | `a19cc0d`, `73b7c36` | Geräte-/Desktopvorschau, Rotation, Anleitung |
| #98 | `5ff7970` | Rasterauswahl und Seiteneinstellungen unter Bearbeiten |
| #99 | `8eedfad` | Stabiler Scrollbalkenplatz gegen pumpende Darstellung |
| #100 | `3844452` | Zusätzliche Rasterdichten 96 und 192 |
| #101 | `1698548`, `e0530e5`, `09c83db`, `663ba3c`, `117dfed`, `2311635` | Responsive Umbrüche, Diagnose, Homescreen-Korrektur und Geräteabnahme |
| #102 | `499e01b` | Seiteneinstellungen ausschließlich Look & Feel |
| #103 | `cacf295` | Navigation anhand tatsächlichen Platzbedarfs |

Vor den Release-Metadaten entsprach der gesamte getrackte Inhalt dem
abgenommenen dev-Stand; einzige Ausnahmen waren Modulversion und die vom
Workflow zu erzeugende Controls-Datei. Lokale, nicht committete Änderungen
an Copilot-Anweisungen und dem bestehenden Backendtest wurden nicht übernommen.

Releaseprüfung auf dem isolierten Branch:

- `perl -c FHEM/01_FHEMCMS.pm`: Syntax korrekt.
- `prove t/*.t`: 465 Prüfungen erfolgreich.
- `node --test t/*.test.js`: 86 Tests erfolgreich.
- `npm ci --ignore-scripts --no-audit --no-fund` und
  `npm run build:check`: reproduzierbarer Build erfolgreich.
- `git diff --check`: keine Patchfehler.

## Ergänzung 2026-11-09: responsive Schema-5-Ansicht

Der Entwickler hat die responsive Ansicht und die platzabhängige Navigation
auf dem iPhone in Safari sowie beim isolierten Start über ein Homescreen-Icon
bestätigt (Issues #101 und #103). Hochformat → Querformat → Hochformat zeigt
nach der Korrektur `117dfed` keine überlappenden Widgets mehr; im Querformat
werden passende Menüeinträge direkt statt als Burger angezeigt.

Der vorherige Fehler ist durch die Diagnose belegt: Bei 361 Pixeln Inhaltsbreite
reservierte WebKit Rasterzeilen von 216 Pixeln für 270,75 Pixel hohe Kacheln.
Die paddingbasierte Höhenreservierung ersetzt `aspect-ratio` am Grid-Item.
Die Prüfseite `www/fhem-cms/examples/fcui-check.html` zeigt seit Revision
`standalone-rotation-2` getrennte Widget-/Content-/Wrapperrechtecke sowie
eine begrenzte Ereignishistorie. Sie verwendet synthetische Daten und
führt keine FHEM-Kommandos aus.

Lokal wurden 50 Umbrüche über fünf Rasterdichten und sieben Navigationslayouts
im Browser geprüft, zusätzlich mehrfache Wechsel zwischen 361 und 702 Pixeln
Inhaltsbreite mit nichtquadratischen Kacheln und exakten Zeilenabständen.
Die CI des Fixes prüfte Build, sämtliche Perl- und JavaScript-Tests erfolgreich.
Das ist eine gezielte Geräteabnahme, keine vollständige Browser-, Rechte-
oder Performanceabnahme der unten dokumentierten offenen MVP-Anforderungen.

## Historisches MVP-Protokoll

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
| Werkzeugleiste (feste Reihenfolge), Verschieben ohne Layout-Modus, Meldungs-Ausrufezeichen | Lokaler Mock (Chromium/Playwright) | ok |
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
2. Navigation über den Button `Navigation` bearbeiten (Seite anlegen, umsortieren, Ausrichtung) und verschieben. Textbaustein mit Formatierung, Tabelle und hochgeladenem Bild (Position ändern, Bildgröße per Ziehpunkt, auch per Touch und Pfeiltasten), Thermostat hinzufügen. Kachel am Griff ziehen, Größe per Griff ändern, per Pfeiltasten verschieben und mit Umschalt+Pfeiltasten skalieren.
3. Backup-Dialog: Liste prüfen, älteren Stand wiederherstellen.
4. Netzwerk trennen (WLAN aus): Kachel muss „Veraltet“ zeigen und sich nach Rückkehr erholen.
5. Ein zweites FHEMWEB mit `allowed` und eingeschränktem Benutzer: Zugriff ohne Rechte muss mit Fehler enden.
6. Auf Phone und Tablet Bedienung, Touch und Tastatur prüfen; Gerät, Browser und Version hier eintragen.
7. Ladezeit (Navigation bis bedienbar) und Reading-Änderung bis Anzeige mit 20 Widgets messen und eintragen.
8. `purge` nur auf einem zusätzlichen Wegwerf-Device testen.
