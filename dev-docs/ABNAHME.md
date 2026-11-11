# MVP-Abnahmeprotokoll (S10)

## Freigegebener Release 1.8.0 (#136, #137, #139)

Am 11.11.2026 bestätigte der Entwickler die Geräteabnahme und gab den
Release nach `main` frei. Der Release-Branch wurde vom stabilen Stand 1.7.0
erstellt; übernommen wurden ausschließlich die folgenden Issue-Commits:

| Issue | ursprüngliche dev-Commits |
|---|---|
| #136 Theme-Manager | 381739e, 294b74c, dc4ee4f, 39fc208, aa9c839, db53034, 6c15a34, d3288ba, 18e2f4a, 9646c7d, c1ea0b8 |
| #137 Mobiles Raster | e846f2e |
| #139 Anrufliste | 028e434, 8124f9a |

Der Theme-Umfang umfasst Forest Green, Hell, Liquid Glass, OLED Black und
Catppuccin Mocha, Seitenbilder und direkte Vorschau. Weitere Theme-Ideen
sind als #140 im Backlog und nicht Teil dieses Releases. Die noch offene Gerätehilfe (#122) und die
Assetsuche (#126) wurden nicht übernommen.

Die Release-Metadaten enthalten die stabile Version 1.8.0; generierte Controls
und `CHANGED` werden vom Workflow erstellt. Die Wiki-Screenshots verwenden
lokal erzeugte Beispieldaten, keine produktiven Gerätedaten.
Releaseprüfung: Perl-Syntax, 686 Perl-Assertions, 150 Node-Tests einschließlich
Chrome-Regressionen, Build-Check und Changelog-Generator erfolgreich.

## Freigegebener Release 1.6.1 (#127)

Am 10.11.2026 hat der Entwickler LinkWidget und Assetmanager als abgenommen
bestätigt und zur Veröffentlichung nach `main` freigegeben. Enthalten sind
#123, #124, #125 und die bereits geschlossene Titelkorrektur #121.
#122 (vollständige DE-/EN-Gerätehilfe) und #126 (Assetsuche) bleiben offen.

Selektive Übernahme von `main` 48380ae, kein Merge des gesamten `dev`:

| Issue | ursprüngliche dev-Commits |
|---|---|
| #121 | adb425a |
| #123 | 91e5258, d862499 |
| #124 | 9910165 |
| #125 | 91521b3, c72fb2f, 28af769, 3278c4c, 42433be, b450453 |

Der Versionskonflikt wurde für die anschließende stabile Version aufgelöst.
Die durch einen Kontextkonflikt angebotene Gerätehilfe und ihr Changelog
wurden ausdrücklich nicht übernommen. Runtime und Tests entsprechen dem
abgenommenen dev-Stand mit Ausnahme der ausgeschlossenen Gerätehilfe und
der stabilen Versionsnummer. KI-Anweisungen wurden nicht nach `main` kopiert.
Die folgenden dev-Protokolle dokumentieren die historischen Zwischenschritte.

Releaseprüfung auf dem isolierten Branch: `perl -c FHEM/01_FHEMCMS.pm`,
639 Perl-Assertions (`prove -l t/*.t`) und alle 110 JS-Tests
(`node --test t/*.test.js`) erfolgreich, einschließlich 204 Assetmanager-
und 100 LinkWidget-Chromiumchecks.

## Nachbesserung 1.6.1-dev: Informations- und Löschdialoge (#125)

Anforderung vom 10.11.2026: Schließen bei EXIF rechts, Verwendungen als eigenes
Popup, beide Löschdialogbuttons rechts und in gleicher Standarddarstellung.
Die zunächst angefragte Dateisystem-Umbenennung wurde ausdrücklich zurückgezogen:
Hash-Dateinamen und bestehende Bildverweise bleiben unverändert. Kein
Migrations-/Namenskonfliktvertrag und keine produktiven Dateiumbenennungen.

- Chromium: `t/51_asset_manager.html` mit 204 Prüfungen. EXIF-Schließen und
  Löschbuttons sind über berechnete Stile und tatsächliche rechte Kanten
  geprüft; Abbrechen/Löschen haben identische Standardrahmen/-hintergründe.
- Verwendungen öffnen ein Modal mit Live-/Entwurfsfundstellen, Seiten und
  Widgets; keine Liste unterhalb des Managers. Auch Löschsperren öffnen dieses
  Popup. Leere Listen melden „Keine Verwendung“. Schließen bereinigt den Dialog.
- Eine erst beim serverseitigen Löschen erkannte Referenz zeigt ebenfalls das
  Popup mit der neuen Fundstelle; Abbrechen per Dialog-Cancel bereinigt es.
- Bestehende Upload-/Drop-/EXIF-/Dateiaktionen bleiben Teil derselben Fixture.
- Zielprüfung: zehn JS-Tests einschließlich 100 LinkWidget-Browserchecks;
  251 Perl-Assertions (`t/04_fcui_assets.t`, `t/06_commandref.t`,
  `t/07_asset_manager.t`), `perl -c FHEM/01_FHEMCMS.pm`,
  `scripts/build-fcui.mjs --check` und `git diff --check` erfolgreich.
  Safari-/FHEM-Geräteabnahme steht weiterhin aus.

Issue-/Kanban-Abgleich: #123 und #124 bleiben zur Geräteabnahme In Review,
#125 nach dieser Nachbesserung ebenfalls; #126 bleibt later/Backlog.
#122 bleibt In Progress: Die Geräteabnahme hat dort zusätzlich vollständige
deutsche **und** englische Hilfe angefordert (Issuekommentar vom 10.11.2026).
Das ist nicht Bestandteil der Asset-Popup-Korrektur. Das bereits durch den
Entwickler geschlossene #121 wird nicht eigenmächtig wieder geöffnet oder als
neuer Release ausgegeben. Kein neuer `main`-Release durch diesen Abgleich.

## Entwicklungsstand 1.6.0-dev: Mehrfachupload und Datei-Drops (#125)

Anforderung vom 10.11.2026: mehrere Bilder auswählen oder per Drag-and-drop
in den geöffneten Ordner ablegen. Nach Upload keine automatisch ausgewählten
Assets/Dateidetails. Die Suche wird vorerst entfernt und separat als #126
mit `later` im Projekt-Backlog geplant; kein aktueller Such-Abnahmeumfang.

Lokale Prüfung:

- `t/51_asset_manager.html`: 185 Chromium-Prüfungen. Mehrere echte `File`-Objekte
  aus der Dateiauswahl werden nacheinander mit aktualisiertem Token direkt in
  den geöffneten Ordner hochgeladen; Detailspalte bleibt geschlossen.
  Drop-Ereignisse prüfen Browser-Standardunterdrückung, Hervorhebung,
  Mehrfachdateien, Zielordner und denselben Uploadpfad.
- Zusätzlich echte Browser-Drag-Events via CDP mit zwei lokalen PNG-Dateien:
  Nach Navigation auf eine Unterebene gehen beide Uploads genau dort hin,
  ohne Dateiauswahl/Details zu öffnen; Wiederladen bestätigt die Ansicht.
- Fehler und Abbruch melden den abgeschlossenen Anteil und starten keine
  folgenden Dateien. Bereits erfolgreiche Dateien bleiben erhalten.
  Die Suche ist weder als Eingabe noch als Filter vorhanden.
- Gemeinsam 10 gezielte JS-Tests erfolgreich, einschließlich Editor,
  100 LinkWidget-Browserprüfungen, EXIF und echtem Perl-Client.
- `perl -c FHEM/01_FHEMCMS.pm` sowie
  `prove -l t/04_fcui_assets.t t/06_commandref.t t/07_asset_manager.t`:
  251 Assertions erfolgreich. Buildcheck und `git diff --check` erfolgreich.

Zur Geräteabnahme: Mehrfachauswahl im nativen Safari-/Edge-Dateidialog sowie
Datei-Drops vom Finder/Explorer testen. Keine produktiven Dateien für lokale
Prüfungen verändert; `main` bleibt unverändert.

## Entwicklungsstand 1.5.0-dev: Dateiaktionen und EXIF (#125)

Anforderung vom 10.11.2026: Umbenennen direkt nach Dateiname, unveränderbare
Endung; Verschieben mit sofortiger Ausführung bei Zielbestätigung; Bildvorschau
mit Vollgrößen-Tooltip und EXIF-Info. Entwicklerentscheidung: Löschbestätigungs-
dialog statt dauerhaftem Haken. Verwendungsschutz bleibt bestehen.

Lokale Prüfung:

- `t/51_asset_manager.html`: 136 Chromium-Prüfungen. Nicht editierbare Endung,
  eigener Umbenennen-Knopf unmittelbar nach Namensfeld, keine gekoppelte
  Move-/Rename-Aktion, ungespeicherte Namensänderung bleibt beim Verschieben
  unberücksichtigt. Zielbestätigung führt den Move aus, Abbrechen schreibt nicht.
  Bildvorschau wird tatsächlich decodiert, Vollgrößen-Link und Tooltip vorhanden.
- Echtes PNG-eXIf-Testbild liefert Kamera, Datum und GPS für das i-Popup;
  ohne EXIF kein i, HTTP-Fehler sichtbar statt als fehlende Metadaten ausgegeben.
  Löschen: kein Haken, kurzer Knopftext, Modal mit Abbruch/Bestätigung;
  verwendete Assets bleiben vor dem Dialog gesperrt. Echte Pointerbewegungen
  prüfen weiterhin Ordnernavigation, Verschieben, Erstellen und Reload.
- `t/52_asset_exif.test.js`: JPEG/PNG, beide Byte-Reihenfolgen, Unter-IFDs,
  Aufnahmedatum/GPS, unveränderte Bytes, beschädigte Längen/Offsets,
  zyklische IFDs und Eintragsgrenzen. Loader nutzt Same-Origin-Credentials,
  unterstützt Abbruch, meldet HTTP-Fehler und beendet Antworten über 50MiB.
- Gemeinsam 10 gezielte JS-Tests erfolgreich, einschließlich Editor,
  100 LinkWidget-Browserprüfungen, Frontend-/Perl-Parität und echtem Perl-Client.
- `perl -c FHEM/01_FHEMCMS.pm` sowie
  `prove -l t/04_fcui_assets.t t/06_commandref.t t/07_asset_manager.t`:
  251 Assertions erfolgreich. Neue EXIF-Datei wird von Controls erfasst.
  Buildcheck und `git diff --check` erfolgreich.

Keine externen Metadatendienste oder neuen Paketabhängigkeiten. Rohmetadaten
einschließlich möglicher Standortinformationen werden nur im lokalen Browser
angezeigt; Originalbilder bleiben unverändert. Herstellerspezifische Binärdaten
sind Rohwerte, lange Werte werden gekennzeichnet gekürzt. Safari/Edge und eigene
Kamerabilder müssen noch am Device abgenommen werden; kein `main`-Release.

## Nachbesserung 1.4.2-dev: ausschließlich Kacheln und Pfad (#125)

Anforderung vom 10.11.2026: kein Bereich „Ordner verwalten“, keine linke
Baumstruktur. Hauptansicht und Zielordnerauswahl navigieren ausschließlich per
Ordnerkachel und klickbarem Pfad. „Ordner erstellen“ steht oberhalb des
Inhaltsfensters, fragt den Namen ab und legt im aktuell geöffneten Ordner an.
Die Ansicht bleibt beim Elternordner und zeigt unmittelbar die neue Kachel.
Bestehende Ordneraktionen bleiben über „⋯“ direkt an der Kachel verfügbar;
Details beanspruchen nur bei Auswahl Platz, sonst volle Breite für die Übersicht.

Lokale Prüfung:

- `t/51_asset_manager.html`: 116 Chromium-Prüfungen. Kein Baum/separater
  Verwaltungsbereich, volle Inhaltsbreite, Erstellen im Stamm-/Unterordner,
  ungültiger Name und Abbruch ohne Schreibzugriff, Kachel-/Pfadnavigation ohne
  Mutation. Echte Pointerklicks erstellen einen Ordner auf der aktuell geöffneten
  Unterebene und verschieben ein Bild mit anschließendem Reload.
- Weiterhin Umbenennen/Verschieben/Löschen über kontextbezogene Kachelaktionen,
  Schutz nichtleerer Ordner, Löschbestätigung, Zielabbruch und Texteditor-
  Integration. LinkWidget: weitere 100 Browserprüfungen erfolgreich.
- Zusammen 7 gezielte JS-Tests erfolgreich in
  `t/19_schema5_editor.test.js`, `t/35_schema5_scaling.test.js`,
  `t/48_link_widget.test.js`, `t/50_asset_client.test.js`.
- `perl -c FHEM/01_FHEMCMS.pm`,
  `prove -l t/07_asset_manager.t t/06_commandref.t` (194 Assertions),
  `node scripts/build-fcui.mjs --check` und `git diff --check`: erfolgreich.

Geräteabnahme in Safari/Edge weiterhin offen. Keine produktiven Dateien oder
Ordner für diese Prüfungen verändert; `main` bleibt unverändert.

## Nachbesserung 1.4.1-dev: Ordnerbrowser und Verschieben (#125)

Geräterückmeldung am 10.11.2026: Bildverschieben ohne Fehlermeldung unklar bzw.
wirkungslos; gewünscht ist eine Finder-artige Auswahl statt Ordner-Dropdowns.
Der Entwickler hat ausdrücklich klargestellt, dass Einträge nicht verschwunden
sind. Kein bestätigter Datenverlust und keine produktiven Testlöschungen.

- Ordnerleiste, Ordnerkacheln und Breadcrumbs; jede Ebene zeigt nur direkte
  Unterordner/Dateien. Ordnerklicks senden keine Schreibbefehle.
- Eigener grafischer Zielordnerdialog mit Inhalt/Vorschau für Asset- und
  Ordnerbewegungen, Abbrechen ohne Zieländerung. Nach Asset-Move wird die
  Antwort auf ID/Name/Ziel geprüft und das Asset im Zielordner angezeigt.
  Nicht übernommene Änderungen führen zu einer sichtbaren Fehlermeldung.
- Leere Ordner benötigen eine getrennte Löschbestätigung mit Pfad.
  Nichtleere Ordner bleiben frontend- und backendseitig geschützt.
- Chromium: `t/51_asset_manager.html`, 95 Prüfungen einschließlich echter
  Pointerklicks auf Ordner, Asset, Zielauswahl und Verschieben, anschließend
  Wiederladen und Prüfung unveränderter Bildadresse. Navigation erzeugt nur
  den ausdrücklich ausgelösten Move und keine Löschaktion.
  Zielabbruch, Ordnerbewegung, negative Move-Bestätigung und Owner-Cleanup
  bei geöffnetem Unterdialog werden zusätzlich geprüft.
- `t/50_asset_client.test.js`: echte Client-/Perl-Persistenz für Bildbewegung
  in Unterordner; erneutes Lesen bestätigt Ziel, Namen und stabile URL.
  Nichtleere Ordnerlöschung wird ohne Bild-/Ordnerverlust abgelehnt.
- Gezielter JS-Lauf beider Tests erfolgreich; `perl -c FHEM/01_FHEMCMS.pm`,
  `prove -l t/07_asset_manager.t t/06_commandref.t` (194 Assertions) und
  `node scripts/build-fcui.mjs --check` erfolgreich.
  Angrenzende Editor-/LinkWidget-Regression gemeinsam erneut geprüft:
  7 JS-Tests erfolgreich, darunter 100 LinkWidget-Browserprüfungen und
  Frontend-/Perl-Parität. `git diff --check` erfolgreich.

Zur erneuten Geräteabnahme: Bild im eigenen Browser auswählen, Zielordner
bestätigen, „Umbenennen / verschieben“ auslösen und nach Neuladen prüfen.
Keine Aussage einer bereits abgeschlossenen Safari-/Edge-Geräteabnahme.

## Entwicklungsstand 1.4.0-dev: Assetmanager und Linkraster (#124, #125)

Lokale Prüfung am 10.11.2026; keine Geräteabnahme und keine `main`-Freigabe:

- LinkWidget: Position/Größe nur grafisch, dauerhaft feines Kachelraster.
- Gemeinsamer Assetmanager über Datei-Menü sowie Bild-/Dokumentauswahl in
  Text- und Linkwidget. Ordner/Unterordner, direkte Ordneruploads,
  Umbenennen/Verschieben, konfigurierbare Typen/Limits und geschützte Löschung.
  Administration vorerst für alle Bearbeiter, Rollen später.
- `perl -c FHEM/01_FHEMCMS.pm` und
  `perl -c FHEM/lib/FHEMCMS/Assets.pm`: erfolgreich.
- `prove -l t/*.t`: 667 Assertions in 7 Dateien erfolgreich, davon
  166 im neuen Assetmanager-Test. Erfasst u.a. Dokumentformate, Limits,
  parallele Katalogänderungen, Altmedienimport, Legacy-Upload-Policy,
  Verwendungen in Live/Entwurf, Löschsperren, ungültige Konfigurationen,
  Metadatengröße und bytegenaue blockweise Downloads mit Zugriffsschutz.
- `node --test t/*.test.js`: 107 Tests erfolgreich, keine übersprungen.
  Nach abschließenden Randfallanpassungen gezielt erneut
  `t/19_schema5_editor.test.js`, `t/35_schema5_scaling.test.js` und
  `t/50_asset_client.test.js`: 10 Tests erfolgreich.
  Datei-Menü-Aufruf ohne Entwurfsschreibzugriff, echter persistenter
  Perl-Client mit Uploadfortschritt/Abbruch und unveränderter Live-Datei.
- Chromium: LinkWidget 100 Prüfungen einschließlich echtem Drag/Resize,
  gemeinsamen Auswahlaktionen und Dokumentlinks; Assetmanager 55 Prüfungen
  für Ordner, Dateien, Administration, Verwendungswarnungen, Texteditor-
  Einfügung, Entfernen nur des Verweises, Fehler und Lifecycle-Bereinigung.
  Übrige Browserregressionen zu Layout, Navigation und Textformatierung grün.
- `node scripts/build-fcui.mjs --check` und `git diff --check`: erfolgreich.
  Der abhängige Migrationsbuild wurde mit dem vorhandenen Buildskript erneuert.

Zur Geräteabnahme: reale FHEMWEB-Uploads und größere Dokumentdownloads,
Authentifizierung/Device-Rechte, Ordnerverwaltung, Live-/Entwurfswarnungen und
Einfügen/Formatierung in Safari/Edge prüfen. Die neuen Assetdialoge wurden lokal
in Chromium, nicht in Safari validiert. Aktive Dokumentinhalte werden nicht
ausgeführt; Signaturprüfungen ersetzen keinen Virenscanner.
Assetdateien separat sichern; ältere Konfigurationsbackups sind keine
Löschsperre. Keine Löschtests auf ungesicherten produktiven Dateien.

## Entwicklungsstand 1.3.0-dev: LinkWidget (#123)

Lokale Prüfung am 10.11.2026, noch keine Geräteabnahme oder `main`-Freigabe:

- `perl -c FHEM/01_FHEMCMS.pm` und `prove -l t/*.t`: erfolgreich
  (487 Assertions einschließlich Gerätehilfe).
- `node --test t/*.test.js`: 104 Tests erfolgreich, keine übersprungen.
  Anschließend gezielt erneut geprüft: 28 Gerätehilfe-Assertions und zwei
  LinkWidget-Tests einschließlich strikter JSON-Typen und aller Rasterdichten.
- `node scripts/build-fcui.mjs --check` und `git diff --check`: erfolgreich.
- `t/48_link_widget.test.js`: positive/negative Frontend-/Perl-Parität für
  Linkziele, Textpositionen, Unicode-Grenzen, Bildpfade und 1–200 Kacheln;
  unbekannte Felder, Überlappungen und Rasterüberläufe werden abgewiesen.
- Chromium: `t/49_link_widget.html`, 99 Prüfungen einschließlich echter
  Pointerbewegung um vier Spalten, Skalierung um zwei Spalten/eine Zeile,
  Speichern/Wiederöffnen, Abbrechen, decodierter lokaler Bilder,
  Upload-/Schreibfehler und Bereinigung.
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
