# Story- und Aufgabenliste

> **Seit 2026-11-01 verwaltet GitHub Issues Status und Aufgaben** ([Issues](https://github.com/stapetz/fhem-cms/issues)). Alle offenen Stories, Bugs und Konzepte aus dieser Liste wurden dort angelegt (Labels `story`, `bug`, `widget`, `navigation`, `layout`, `editor`, `security`, `safari`, `concept`, `needs-test`, `draft`, `later`). Diese Datei bleibt als Archiv und für Hintergründe; neue Stories und Statusänderungen gehören ins Issue. Vollständig erledigte Stories (S01, S08, S09, S17, S20–S25, S27, S30) wurden nicht migriert.
>
> Zuordnung: S02: #2, S03: #3, S04: #4, S05: #5, S06: #6, S07: #7, S10: #8, S11: #9, S12: #10, S13: #11, S14: #12, S15: #13, S16: #14, S18: #15, S19: #16, S26: #17, S28: #18, S29: #19, S31: #20, S32: #21, S33: #22, S34: #23, S35: #24, S36: #25, S37: #26, S38: #27, S39: #28, S40: #29, S41: #30, S42: #31, S43: #32, S44: #33, S45: #34, S46: #35, B01: #36, B02: #37, B03: #38, B04: #39, K01: #40, B05: #41, K02: #42, Später: #43, Später: #44, Später: #45, Später: #46.

Diese Liste ordnet die bekannten Stories nach ihren Voraussetzungen und der vorgeschlagenen Umsetzungsreihenfolge. Sie ist das gemeinsame Arbeitsboard in der Entwicklerdokumentation.

- Offene Stories stehen als `- [ ]`, abgeschlossene Stories als `- [x]`.
- Eine Story ist erst abgeschlossen, wenn ihre Akzeptanzkriterien geprüft sind und nötige Tests sowie Dokumentation vorliegen.
- Neue bekannte Stories werden am Ende ergänzt. Wenn eine neue Voraussetzung die Reihenfolge ändert, wird die Abhängigkeit hier festgehalten und betroffene Stories werden gemeinsam neu geordnet.
- Entscheidungen mit Auswirkungen auf das Zielbild oder die Architektur werden zusätzlich in [ENTWICKLUNG.md](./ENTWICKLUNG.md) dokumentiert.
- Stories sind zunächst Vorschläge aus dem aktuellen Anforderungsstand. Umfang, Reihenfolge und Abnahmewerte können gemeinsam angepasst werden.

## Reihenfolge

### S01 - MVP-Umfang und Referenzumgebung festlegen

**Ziel:** Ein gemeinsames, prüfbares erstes Lieferziel festlegen, bevor technische Details unumkehrbar werden.

**Aufgaben**

- [x] MVP-Funktionen und explizite Nicht-Ziele bestätigen.
- [x] FHEM 6.5 als Mindest-Baseline für Integrationstests bestätigen und Testprozedur gegen die stabile Releaseversion dokumentieren.
- [x] Browsermatrix für Windows, macOS, Linux, Android und iOS festlegen: Edge, Chrome, Firefox und Safari auf den jeweils verfügbaren Kombinationen.
- [x] Mindestversionen auf aktuelle und vorherige stabile Hauptversion festlegen. Konkrete Phone-/Tablet-Referenzgeräte werden vor der MVP-Abnahme in S10 protokolliert.
- [x] Mobile-First-Abnahmekriterien für Phone, Tablet und Desktop festlegen.
- [x] Ziele von 2 Sekunden bis zur bedienbaren Ansicht und 500 ms bis zur sichtbaren Zustandsänderung für 20 Widgets bestätigen.
- [x] Messbedingungen für Performance und Serverlast dokumentieren.

**Akzeptanzkriterien**

- MVP-Umfang, Nicht-Ziele und Zielumgebung stehen in `ENTWICKLUNG.md`.
- FHEM 6.5 oder eine neuere stabile Version ist als unterstützte Baseline festgehalten; der unterstützte Browser-/Betriebssystemumfang und die Browser-Mindestversionen sind dokumentiert.
- Phone-, Tablet- und Desktop-Ansichten sind Teil der Abnahmematrix und werden Mobile-First geprüft; konkrete Modelle werden mit den S10-Abnahmetests festgehalten.
- Leistungsziele und Messmethode stehen in `ENTWICKLUNG.md`; Browser-/Gerätekombinationen und Ergebnisse werden bei der S10-Abnahme protokolliert.

### S02 - FHEM-Integrationsweg und Kommunikation validieren

**Abhängigkeit:** S01.

**Ziel:** FHEMs normale `www`-Auslieferung für Frontend-Dateien von der JSON-API und dem Transport für Live-Zustände des Steuerungsmoduls abgrenzen.

**Aufgaben**

- [x] FHEMs `www`-Verzeichnis und die normale URL-Abbildung für statische Dateien untersuchen und mit dem Testdevice bestätigen.
- [x] Festlegen, wie `www/fhem-cms/` im Entwicklungs- und Installationsablauf bereitgestellt wird.
- [x] Gemeinsame FTUI3-inspirierte Ressourcenstruktur und URL-Konvention für Device-Einstiegspunkte festlegen (`<FHEM-Device-Name>/index.html`).
- [x] FHEMWEB-Inform via WebSocket und HTTP-Langpoll anhand des aktuellen FHEM-Quellcodes vergleichen; Grenzen und offene Laufzeit-/Berechtigungsprüfung dokumentieren.
- [x] Einen temporären Read-only-Machbarkeitsprototyp erstellen, ausführen und nach dem Test wieder entfernen.
- [x] Die WebSocket-Verbindung aus FHEMWEB sowie `on`-/`off`-Statusänderungen in der FHEM-Instanz des Entwicklers prüfen.
- [ ] Die genaue FHEM-Version festhalten und den Initialstatus, FHEM-6.5-Kompatibilität sowie Geräte-/Reading-Berechtigungen und unberechtigte Verbindungen prüfen.
- [ ] Gewählte Architektur und verworfene Alternativen nach dem Machbarkeitsnachweis mit Begründung in `ENTWICKLUNG.md` festhalten.

**Akzeptanzkriterien**

- Statische Assets sind über FHEMs normalen `www`-Kontext erreichbar, ohne dass das Steuerungsmodul HTML- oder Asset-Seiten selbst ausliefert.
- Die Ablage gemeinsamer Ressourcen und von `www/fhem-cms/<device>/index.html` ist dokumentiert.
- Der erforderliche JSON-Endpunkt und Live-Datentransport sind über einen dokumentierten, kompatiblen Weg erreichbar.
- Für Live-Daten ist geklärt, wie Verbindung, Authentifizierung, Nachrichtenformat und Abonnement-Lebenszyklus funktionieren.
- Die Lösung benötigt keine ungeprüfte oder nicht dokumentierte Abhängigkeit.

### S03 - Sicherheits- und Berechtigungsmodell definieren

**Abhängigkeit:** S02.

**Ziel:** Vertrauensgrenzen und erlaubte Zugriffe vor der Implementierung von APIs und Widgets festlegen.

**Aufgaben**

- [x] Sicherheitsleitplanken für FHEM-Sitzung, gleich-originige Zugriffe, CSRF, fehlende Steuerbefehle, Geräte-/Reading-Validierung und Logging in `ENTWICKLUNG.md` festhalten.
- [ ] Nutzung von FHEM-Sitzung, Authentifizierung und Berechtigungen für HTTP- und dauerhafte Verbindungen nachweisen.
- [ ] CSRF-Schutz und erlaubte Ursprünge für schreibende/API-Aufrufe definieren.
- [ ] Erlaubte Geräte/Readings und serverseitige Validierung spezifizieren.
- [ ] Regeln für Steuerbefehle definieren; bis zur Freigabe bleiben sie außerhalb des MVP.
- [ ] Regeln für Markdown, Pfade, Konfigurationsgrößen, Logging und spätere Uploads/Plugins dokumentieren.

**Akzeptanzkriterien**

- Die Sicherheitsregeln stehen in `ENTWICKLUNG.md`; offene Prüfungen gegen die konkrete FHEM-Referenzinstanz sind dokumentiert.
- Es gibt keine API, über die der Browser ungeprüfte FHEM-Befehle oder Dateipfade übermitteln kann.
- Negativtests für nicht autorisierte Zugriffe und ungültige Eingaben sind festgelegt.

### S04 - JSON-Konfigurationsschema und Persistenz definieren

**Abhängigkeit:** S01.

**Ziel:** Ein versioniertes und sicher speicherbares Format für Seiten, Layouts und Widgets festlegen.

**Aufgaben**

- [x] Schema für Seiten, Komponenten, IDs und Layoutdaten definieren (`schemaVersion` 1, `pages[]`, `widgets[]`, Raster `col`/`row`/`w`/`h`, erstes Widget `fhem-value`).
- [x] Regeln für Schema-Versionen und unbekannte Felder festlegen (strikt abweisen). Migrationen sind noch offen.
- [x] Speicherort und Dateinamenskonvention festlegen: `<modpath>/fhem-cms-data/<Device>/config.json`.
- [x] Größenlimit (1 MiB), atomares Schreiben und Backups mit Zeitstempel (letzte 20) umgesetzt.
- [x] Bestehende Devices werden beim nächsten `define`/FHEM-Start nachträglich mit Datenordner und Default-Konfiguration ausgestattet.
- [ ] Wiederherstellungsdialog im Frontend, Löschfunktion mit Bestätigung und Beispiele in einer technischen Spezifikation.

**Akzeptanzkriterien**

- Gültige Beispielkonfigurationen bestehen die Schema-Validierung; ungültige werden abgewiesen.
- Der Speicherpfad ist festgelegt und kann nicht durch Benutzereingaben verlassen werden.
- Das Schema kann versioniert erweitert werden, ohne bestehende Konfigurationen stillschweigend zu beschädigen.

### S05 - Binding- und Widget-Schnittstelle definieren

**Abhängigkeiten:** S01, S03 und S04.

**Ziel:** Festlegen, wie JSON-Konfigurationen zu Web Components werden und wie Widgets FHEM-Daten anzeigen.

**Aufgaben**

- [x] Erstes Widget (Thermostat-Kachel, lesend und Sollwert setzen) und seine JSON-Felder festgelegt und als Test umgesetzt.
- [ ] Zuordnung von Device/Reading zu Initialwerten und Live-Änderungen spezifizieren.
- [ ] Lade-, Fehler-, Offline- und Berechtigungszustände definieren.
- [ ] Benutzeraktionen von lesenden Bindings trennen.
- [ ] Die frühere Angular-ähnliche Syntax nicht als Vertrag verwenden.

**Akzeptanzkriterien**

- Ein vollständiges, validierbares Beispiel für ein lesendes Widget ist dokumentiert.
- Das Frontend kann keine ausführbaren Expressions aus einer gespeicherten Konfiguration ausführen.
- Die Schnittstelle funktioniert mit der in S02 gewählten Kommunikation.

### S06 - FHEM-Backend-Grundlage implementieren

**Abhängigkeiten:** S02, S03 und S04.

**Ziel:** Das Steuerungsmodul legt pro Device einen HTML-Bootstrap an und stellt sicheres Laden und Speichern von Konfigurationen bereit. Statische Frontend-Dateien werden unabhängig davon von FHEMs normaler `www`-Auslieferung bereitgestellt.

**Aufgaben**

- [x] Die gemeinsame FTUI3-inspirierte Ressourcenstruktur unter `www/fhem-cms/` anlegen: `components/`, `examples/`, `icons/`, `images/`, `js/`, `modules/`, `css/` und `themes/`.
- [x] Beim `define` eines CMS-Devices eine HTML-Startdatei direkt unter `www/fhem-cms/<FHEM-Device-Name>/index.html` erzeugen; sie referenziert gemeinsame Ressourcen und startet das richtige Device.
- [x] Device-Pfad und `get <device> url` dokumentieren. Startseiten werden exklusiv erzeugt, fremde Dateien nicht überschrieben und beim `undef` nicht gelöscht.
- [x] Neue Devices standardmäßig dem Raum `FHEM CMS` zuordnen und in der FHEMWEB-Raumansicht einen direkten Link zur Startseite anzeigen; eine vorhandene Raumzuordnung bleibt erhalten.
- [ ] Eine separate Datenlöschfunktion mit Bestätigung umsetzen, die den betroffenen Device-Ordner anzeigt und die Optionen Löschen, Behalten und Abbrechen anbietet. Das normale FHEM-`delete <device>` behält die Dateien.
- [x] Eine zentrale `controls_fhem-cms.txt` für das gesamte Repository generieren und über GitHub Actions nach Branch-Updates aktualisieren.
- [x] FHEM-Installationsbefehle für `dev` und `main` in der README dokumentieren; alle Laufzeitdateien werden über eine gemeinsame Update-Quelle installiert.
- [x] Die erste wiederverwendbare Web Component `cms-device-card.js` erstellen und in das Testfrontend integrieren (mit S17 wieder entfernt).
- [ ] JSON-Lese-/Schreib-API mit Schema- und Pfadvalidierung umsetzen.
- [ ] FHEM-Sitzung und Berechtigungen serverseitig prüfen.
- [ ] Fehlerfälle nachvollziehbar protokollieren, ohne sensible Werte zu loggen.
- [ ] Perl-Syntaxprüfung und passende Tests hinzufügen.

**Akzeptanzkriterien**

- Autorisierte Nutzer können eine gültige Konfiguration laden und speichern.
- Für jedes definierte CMS-Device existiert ein erreichbarer HTML-Einstiegspunkt unter `www/fhem-cms/<FHEM-Device-Name>/index.html`, der das Device startet und gemeinsame Frontend-Assets referenziert.
- Neue Devices erscheinen standardmäßig im Raum `FHEM CMS`; der Link in der Raumansicht öffnet den CMS-Einstieg unter dem aktuellen FHEMWEB-Pfad.
- Jedes Device bildet eine vollständige Inhaltsstruktur mit einer Startseite und Navigation zu weiteren Inhaltsseiten ab. Ein weiteres Device erhält einen eigenen Ordner und Einstiegspunkt.
- Das Steuerungsmodul registriert keinen eigenen HTML-/Asset-Web-Endpunkt; statische Dateien werden aus dem `www`-Kontext ausgeliefert.
- Die einzelne `controls_fhem-cms.txt` enthält sowohl das FHEM-Modul als auch alle gemeinsamen Assets und Komponenten, ohne eine Update-Aufteilung nach Modulen.
- Die README beschreibt Installation aus Entwicklungs- und freigegebenem Branch über jeweils diese eine Controls-Datei.
- Ungültige, zu große oder nicht autorisierte Anfragen werden mit erkennbaren Fehlern abgewiesen.
- Keine angeforderte Device-ID oder Datei kann aus dem vorgesehenen CMS- oder Datenverzeichnis ausbrechen oder fremde Dateien überschreiben.
- Konfigurationen bleiben nach einem FHEM-Neustart verfügbar.

### S07 - SPA-Grundgerüst und Seitenrendering erstellen

**Abhängigkeiten:** S01, S04, S05 und S06.

**Ziel:** Eine gespeicherte Konfiguration als navigierbare, responsive CMS-Seite darstellen.

**Aufgaben**

- [x] Frontend-Grundgerüst unter `www/fhem-cms/` mit HTML-Bootstrap, Mobile-First-CSS und JS-Initialisierung anlegen.
- [x] JSON-Konfiguration laden und validierte Seiten/Widgets rendern.
- [x] Grundlegende Navigation und Layoutdarstellung implementieren.
- [ ] Lade-, Fehler- und Berechtigungszustände anzeigen.

**Akzeptanzkriterien**

- Eine gültige gespeicherte Beispielseite wird ohne manuelle Anpassung im Browser dargestellt.
- Der devicebezogene HTML-Bootstrap lädt gemeinsame Assets aus `www/fhem-cms/` und startet genau das zugehörige Device.
- Unbekannte oder ungültige Widgettypen führen zu einem sichtbaren, kontrollierten Fehler statt zu ausführbarem Markup.
- Kernnavigation und Layout sind auf der vereinbarten Zielumgebung bedienbar.

### S08 - Redaktionellen Textbaustein umsetzen

**Abhängigkeiten:** S04, S06 und S07.

**Ziel:** Redaktionelle Inhalte als Kern des CMS sicher anzeigen und bearbeiten können.

**Aufgaben**

- [x] Text-/Markdown-Komponente spezifizieren und umsetzen.
- [x] Darstellung gegen XSS absichern; erlaubte Markdown-Funktionen definieren.
- [x] Bearbeiten und Speichern über die validierte Konfigurations-API integrieren.
- [x] WYSIWYG-Editor (Formatierung, Links, Tabellen, Bilder mit Positionierung) mit Allowlist-Validierung in Frontend und Modul.
- [x] Bild-Upload (`set media`, `get media`) mit Typ-, Größen- und Mengenprüfung.
- [x] Kacheln im Layout-Modus frei im Raster verschieben.
- [x] `set restore` zeigt Backups als Auswahlliste.

**Akzeptanzkriterien**

- Text kann erstellt, gespeichert, nach Neustart wieder geladen und angezeigt werden.
- Testinhalte mit HTML-/Script-Payloads werden nicht als ausführbarer Code behandelt.
- Bedienung ist mit Maus, Touch und Tastatur möglich.

### S09 - Lesendes FHEM-Widget und Live-Zustände umsetzen

**Abhängigkeiten:** S02, S03, S05, S06 und S07.

**Ziel:** Ein konfiguriertes FHEM-Reading initial und bei Änderungen anzeigen.

**Aufgaben**

- [x] Serverseitige Prüfung von Device- und Reading-Abonnements: Das Frontend verwendet ausschließlich FHEMWEB (`jsonlist2`, `inform`); Authentifizierung, `allowed` und Device-Rechte bleiben bei FHEMWEB. Das CMS fragt nur Devices der konfigurierten Widgets ab (Namen validiert).
- [x] Initialwerte und Live-Änderungen über die gewählte Kommunikation übertragen.
- [x] Abonnements bei Seitenwechsel, Verbindungsende und Sitzungsende aufräumen.
- [x] Reconnect mit erneutem Laden aktueller Zustände und Wiederherstellen der Abonnements umsetzen.
- [x] Offline-, Fehler- und veraltete Zustände in der UI sichtbar behandeln.

**Akzeptanzkriterien**

- Nur konfigurierte und autorisierte Readings werden übertragen.
- Nach einem Reconnect zeigt das Widget den aktuellen Backend-Zustand, nicht nur zwischenzeitliche Nachrichten.
- Es bleiben nach einem Seitenwechsel oder Verbindungsende keine unnötigen Abonnements bestehen.
- Die bestätigten Performance- und Serverlastziele aus S01 werden gemessen.

### S10 - MVP-Abnahme und Dokumentation abschließen

**Abhängigkeiten:** S06 bis S09.

**Ziel:** Den festgelegten MVP auf der Referenzumgebung reproduzierbar prüfen.

**Aufgaben**

- [ ] Testfälle für Berechtigungen, ungültige Daten, Neustart und Verbindungsabbruch ausführen. (Ungültige Daten, Neustart, Verbindungsabbruch im Mock/Perl geprüft; Berechtigungen offen, siehe `ABNAHME.md`.)
- [ ] Browser-, Tastatur- und Touch-Bedienung auf den vereinbarten Zielgeräten prüfen.
- [ ] Die Phone-/Tablet-Referenzmodelle vor Testbeginn festlegen und zusammen mit Browser-Version und Ergebnis protokollieren.
- [ ] Performance und Serverlast mit den S01-Messbedingungen bewerten.
- [x] Installations-, Konfigurations- und Fehlerbehebungsdokumentation für Anwender erstellen (`docs/ANWENDER.md`, inkl. `allowed`-Hinweis).
- [ ] Abweichungen und Folgestories am Ende dieser Liste ergänzen. (Protokoll mit offenen Punkten: `dev-docs/ABNAHME.md`.)

**Akzeptanzkriterien**

- Alle MVP-Kriterien aus `ENTWICKLUNG.md` sind nachweislich erfüllt oder Abweichungen sind ausdrücklich akzeptiert und dokumentiert.
- Tests und Installationsschritte sind für Entwickler nachvollziehbar.
- Der Stand ist erst nach ausdrücklicher Freigabe zur Veröffentlichung auf `main` vorgesehen.

## Geplante Folgestories

### S11 - Bildgröße höher erlauben

**Ziel:** Handyfotos ohne Handarbeit nutzen können.

- [x] Größenlimit für Uploads auf 3 MiB angehoben (`$FHEMCMS_MAX_MEDIA_BYTES`, `MAX_IMAGE_BYTES`).
- [ ] POST-Größe (ca. 4,2 MB als Base64) über FHEMWEB und nginx (`client_max_body_size`) auf der Testinstanz messen und das Ergebnis dokumentieren.

### S12 - Medienverwaltung

**Ziel:** Alle Bilder (und später weitere Medien-Assets) über eine eigene Oberfläche verwalten.

- [ ] Medienverwaltung als eigene Oberfläche mit Liste aller Assets und direktem Upload.
- [ ] Anzeige je Asset, ob es verwendet wird und auf welchen Seiten. „In Verwendung“ prüft Live-Stand und Entwurf (S13).
- [ ] Löschen aus der Medienverwaltung; bei verwendeten Assets erscheint vorher ein Warndialog. Der Löschbefehl im Modul prüft strikt (nur MD5-Dateinamen, keine Pfade).
- [ ] Der Texteditor ersetzt „Bild hochladen“ durch „Bild auswählen / hochladen“, das direkt die Medienverwaltung öffnet, in der ein Bild hochgeladen oder ein vorhandenes gewählt wird.
- [ ] Thema Bildgröße pragmatisch neu bewerten: Limit, Verkleinern vor dem Upload im Browser (Canvas, z. B. höchstens 1600 px Kantenlänge; Auswirkung auf Transparenz und GIF-Animation) und Serverlast.
- [ ] Konzept für weitere Asset-Typen und deren Sicherheitsregeln (MIME-Typen von FHEMWEB beachten).

**Akzeptanzkriterien**

- Verwendete und unverwendete Bilder sind unterscheidbar, die Fundstellen sind sichtbar.
- Ein verwendetes Bild wird nie ohne Warnung gelöscht.
- Bedienung ist mit Maus, Touch und Tastatur möglich.

### S13 - Entwurf und Veröffentlichen

**Ziel:** Bearbeitung verändert die ausgelieferte Seite nicht, bis sie ausdrücklich freigegeben wird.

- [x] Pro Device ein einzelner Entwurf (`draft.json`). Der Bearbeitungsmodus liest und schreibt nur den Entwurf (`get draft|status`, `set draft`).
- [x] „Zeige Homepage“ (Aufruf ohne Parameter; Bearbeitung nur mit `?mode=edit`) liest immer den Live-Stand (`config.json`).
- [x] `set publish` validiert den Entwurf, sichert den bisherigen Live-Stand als Backup, schreibt den Entwurf als Live-Stand und löscht ihn. Die neue Version erscheint im Restore-Dialog.
- [x] `set discard` und Schaltfläche „Entwurf verwerfen“; Hinweiszeile zeigt, ob ein Entwurf offen ist.
- [x] `restore` und Backups beziehen sich nur auf den Live-Stand; ein vorhandener Entwurf bleibt unverändert.
- [ ] Auf der Testinstanz prüfen (Bearbeiten, Veröffentlichen, Verwerfen, Restore mit offenem Entwurf).
- [x] Bei `restore` bleibt ein vorhandener Entwurf unverändert und wird nicht automatisch aus dem wiederhergestellten Live-Stand neu erzeugt; der Statushinweis erläutert das Verhalten.

**Bewusst akzeptiert:** Zwei Benutzer können denselben Entwurf gleichzeitig bearbeiten; der letzte Speichervorgang gewinnt. Schutz folgt mit S14.

### S14 - Rechte- und Rollenkonzept

**Ziel:** Wer darf bearbeiten, veröffentlichen, wiederherstellen und löschen?

- [ ] Rollen (z. B. Betrachter, Redakteur, Administrator) und Abbildung auf FHEMWEB/`allowed`.
- [ ] Sperre (Semaphore oder Lock mit Ablauf) gegen gleichzeitiges Bearbeiten desselben Entwurfs, inkl. Anzeige, wer gerade bearbeitet.
- [ ] Mehrere Entwürfe und Freigabeprozess prüfen.

### S15 - Bildgröße per Ziehpunkt

**Ziel:** Bilder im Editor direkt am Rahmen größer und kleiner ziehen, ohne Prozentangaben.

- [x] Ziehpunkt unten rechts am gewählten Bild, Seitenverhältnis bleibt erhalten (Maus, Touch, Pfeiltasten).
- [x] Breite in 5-%-Schritten (`cms-w-5` bis `cms-w-100`); Frontend-Cleaner und Modul-Validierung angepasst. Die festen Prozent-Schaltflächen entfallen.
- [ ] Touch-Ziehen auf einem echten Gerät prüfen (Konflikt mit Scrollen).

### S16 - Kachelgröße im Layout-Modus

**Ziel:** Position und Größe der Kacheln nur noch direkt auf der Seite ändern, nicht über Zahlenfelder.

- [x] Größengriff unten rechts an jeder Kachel im Layout-Modus (ziehen oder Umschalt+Pfeiltasten), Einrasten im Raster, überlappende Kacheln rutschen nach unten.
- [x] Die Felder „Position im 12-Spalten-Raster“ sind aus den Dialogen entfernt. Neue Kacheln starten in Spalte 1 in der ersten freien Zeile mit Standardgröße.
- [ ] Touch-Bedienung auf einem echten Gerät prüfen.

### S17 - Schlanke Seite ohne Kopfbereich

**Ziel:** Die Seite beginnt direkt mit den Inhalten. Eine Überschrift schreibt, wer sie möchte, selbst in einem Textbaustein.

- [x] Kopfbereich (Kicker, Überschrift, Einleitungstext) und Device-Karte entfallen; die Komponente `cms-device-card` wird entfernt.
- [x] Status und Fehlermeldungen erscheinen in einer schlichten Statuszeile (im Ansichtsmodus nur bei einem Fehler).
- [x] Die Seite beginnt ganz oben im Browserfenster (keine vertikale Zentrierung des Inhalts mehr).

### S18 - Navigations-Widget

**Ziel:** Die Seitennavigation ist ein eigenes, frei platzierbares Widget, das auf allen Seiten gleich gilt.

- [x] Die Navigation steht global in der Konfiguration (`navigation` mit `orientation` und `grid`) und wird im Layout-Modus wie jede Kachel verschoben und in der Größe geändert. Die Position gilt für alle Seiten; Kacheln anderer Seiten rutschen bei Überlappung nach unten.
- [x] Ausrichtung wählbar: horizontal oder vertikal.
- [x] Der Dialog „Navigation“ enthält Seite anlegen, umbenennen, löschen und Reihenfolge ändern. Die Seitenbuttons verschwinden aus der Werkzeugleiste.
- [x] Bestehende Konfigurationen ohne `navigation` erhalten eine Standardnavigation (horizontal, Zeile 1, volle Breite); die Kacheln rutschen dafür um die Navigationshöhe nach unten.
- [x] Reihenfolge per Ziehen am ☰-Griff (statt Pfeilen hoch/runter).
- [x] Der Dialog arbeitet auf einer Arbeitskopie: „Speichern“ übernimmt alle Änderungen in den Entwurf, „Abbrechen“ verwirft sie (statt „Schließen“ mit sofortigem Speichern).
- [ ] Navigation pro Seite ausblenden (nicht umgesetzt).

### S19 - Versionsverwaltung für Seiten

**Ziel:** Aus den „Backups“ im Editor wird eine echte, optische Versionsverwaltung.

- [ ] „Backups“ heißt im Editor „Versionen“ (Dialog, Schaltflächen, Doku).
- [ ] Zwei Versionen nebeneinander vergleichen, auch optisch (gerenderte Seiten gegenüberstellen, Unterschiede kenntlich machen).
- [ ] Nach dem Vergleich ausdrücklich wählen, welche Version behalten wird.
- [ ] Alte Versionen löschen können (mit Warnung; die aktuelle Live-Version bleibt geschützt).
- [ ] Bezug zu S13: Wiederherstellen wirkt weiterhin nur auf den Live-Stand.

### S20 - Navigationspunkte: Größe und Beschriftung

**Ziel:** Die Navigationspunkte („Bubbles“) sehen einheitlich aus und lassen sich je Eintrag anpassen.

- [x] Standard: Alle Bubbles übernehmen die Größe des größten Eintrags.
- [x] Je Eintrag ist die Beschriftung änderbar (Standard: Seitenname, überschreibbar).
- [x] Je Eintrag ist eine eigene Größe in x- und y-Richtung in Pixeln einstellbar.
- [x] Schema-Erweiterung in `navigation` (optional je Eintrag), Validierung und Tests.

### S21 - Texteditor: Farben

**Ziel:** Der WYSIWYG-Editor bietet Textfarbe und Hervorhebung.

- [x] Farbauswahl für die Schrift.
- [x] Text hervorheben mit frei wählbarer Farbe.
- [x] Erlaubte Farbwerte in der HTML-Allowlist und im Modul prüfen (kein freies `style`).
### S22 - Aufgeräumte Werkzeugleiste und Meldungen

**Ziel:** Feste Reihenfolge der Befehle, Kacheln ohne Zusatzmodus verschiebbar, Meldungen unauffällig.

- [x] Feste Reihenfolge im Bearbeitungsmodus: Navigation, + Widget, Vorschau, Veröffentlichen, Entwurf verwerfen (Backups folgt am Ende, bis S19 es durch „Versionen“ ersetzt).
- [x] Der Button „Navigation“ steht in der Werkzeugleiste (nicht mehr im Navigations-Widget).
- [x] „Layout ändern“ entfällt: Im Bearbeitungsmodus sind Kacheln und Navigation immer verschiebbar und in der Größe änderbar, ohne Einfärbung (dezenter Griff ⠿ am Kopf der Kachel, Größengriff beim Darüberfahren).
- [x] Statuszeile und Entwurfshinweis entfallen. Im Bearbeitungsmodus zeigt ein rotes Ausrufezeichen oben rechts die Meldungen als Tooltip.
- [x] Im Ansichtsmodus erscheinen nur akute Fehlermeldungen.
- [x] Die Leiste schwebt über der Seite (`position: fixed`) und zählt nicht zum Raster des Seiteninhalts; Inhalte lassen sich bis an den oberen Seitenrand schieben.
- [x] Die Befehle sehen aus wie die Menüleiste klassischer Programme (Word, Pages): eine zusammenhängende, beim Scrollen oben haftende Leiste mit flachen Einträgen, Trennstrichen zwischen den Gruppen und einem Dropdown „+ Widget ▾“.

### S23 - Gitternetz im Bearbeitungsmodus

**Ziel:** Das Raster des Seiteninhalts ist beim Platzieren sichtbar.

- [x] Schaltfläche ▦ am Ende der Werkzeugleiste blendet das 48-Spalten-Raster als gestrichelte Gitterlinien ein oder aus. Die Einstellung bleibt pro Browser erhalten.
- [x] Das Gitternetz reicht mindestens zwei Zeilen unter den Inhalt und wächst beim Verschieben mit.
- [x] Nur im Bearbeitungsmodus; Ansicht und Vorschau zeigen kein Gitternetz.

### S24 - Werkzeugleiste links, Meldungsbox

- [x] Werkzeugleiste im Bearbeitungsmodus linksbündig und blau, um sie von der Seitennavigation abzuheben.
- [x] Die Leiste besteht aus Menüs wie in klassischen Programmen: Datei (Vorschau, Veröffentlichen, Entwurf verwerfen, Backups), Bearbeiten (Navigation), Einfügen (Widgets), Ansicht (Raster).
- [x] Das Ausrufezeichen ist im Bearbeitungsmodus immer sichtbar.
- [x] Klick auf das rote Ausrufezeichen öffnet eine kleine Box mit den Meldungen (statt Tooltip).

### S25 - Wert-Anzeige (Device, Reading, Einheit, Icon)

**Ziel:** Ein einfaches Widget zeigt ein Reading eines Devices an.

- [x] Widget `fhem-value`: Device über den Suchdialog (wie bei der Thermostat-Kachel), Reading aus den Readings des gewählten Devices.
- [x] Optionale Einheit hinter dem Wert: Vorschläge als Schaltflächen im Dialog (°C, %, km, …) plus freier Text (kein natives `datalist`, das aus dem Dialog sprang).
- [x] Optionales Icon aus dem FHEM-Icon-Verzeichnis vor dem Wert (Auswahl mit Filter; Liste über `get <CMS> icons`).
- [x] Schema validiert `unit` und `icon` streng; Wert wird live aktualisiert.
- [x] Verschieben, Skalieren und Löschen wie bei den anderen Kacheln.
- [x] Die Kachel ist beliebig verkleinerbar (Rasterzeile mindestens 2,75 rem); Schrift, Einheit und Icon skalieren mit der Kachelgröße (Container-Einheiten), das ⚙ entfällt bei sehr schmalen Kacheln.
- [x] Icon-Auswahl: alle Stile werden gelistet, nicht ladbare Kacheln verschwinden.
- [x] Icons werden als CSS-Maske in der Themenfarbe (`--cms-icon-color`, hellgrün `#8fd0a8`) gezeichnet statt schwarz; mehrfarbige Icons werden dadurch einfarbig.

### S26 - Menüleiste nimmt Platz ein, Navigationszeile passt sich an

- [x] Die Menüleiste im Edit-Modus überdeckt den Seiteninhalt nicht mehr; das Raster beginnt unterhalb der Leiste.
- [x] Eine Rasterzeile, die nur die waagerechte Navigation (Höhe 1) enthält, passt sich der Höhe der Navigationspunkte an.
- [x] Fix: Der Verschiebegriff der Navigation ist klein und rechts, die Seitenlinks bleiben im Edit-Modus anklickbar.
- [ ] Senkrechte Navigation: Spaltenbreite bleibt vorerst 1/12 der Seitenbreite.

### S27 - Menüs öffnen beim Überfahren

- [x] Mit der Maus öffnen die Menüs der Bearbeitungsleiste beim Überfahren und schließen nach Verlassen (250 ms Verzögerung).
- [x] Auf Touch-Geräten und per Tastatur öffnen sie weiterhin per Klick.

### S28 - Navigation als Burgermenü auf schmalen Bildschirmen

- [ ] Wird das Browserfenster (Smartphone, kleines Fenster) sehr schmal, erscheint die Navigation als klassisches Burgermenü statt als Leiste.
- [ ] Umschaltschwelle: Fensterbreite unter 600 px (entschieden). Auf-/Zuklappen und Schließen nach der Seitenwahl sind noch festzulegen.
- Umsetzung später (vom Nutzer so entschieden).

### S29 - Unterpunkte in der Navigation (beliebige Tiefe)

- [ ] Navigationspunkte können Unterpunkte haben, die Tiefe ist unbegrenzt; Darstellung wie die Menüs der Bearbeitungsleiste (Aufklappen beim Überfahren, auf Touch per Klick, im Burgermenü eingerückt).
- [ ] Verschieben im Navigationsdialog (entschieden): Am Griff ⠿ ziehen; nach rechts ziehen rückt ein (Unterpunkt), nach links eine Ebene höher.
- [ ] Schema: Einträge in `navigation.items` erhalten einen Verweis auf den übergeordneten Eintrag; Zyklen werden abgelehnt.
- [ ] Ein Punkt ohne eigene Seite darf als reine Gruppe dienen (entschieden).
- [ ] Ergänzt am 2026-10-31: Server prüft Zyklen, fehlende Eltern und eine Obergrenze der Tiefe; Löschen eines Eltern-Eintrags fragt nach (Kinder anheben oder mitlöschen); Baum-Rolle und Tastaturbedienung für Screenreader; Tests für Schema, Zyklen, Migration; Abstimmung mit S28 und S46.
- Umsetzung später (vom Nutzer so entschieden).

### S30 - Thermostat schreibt wie das ThermostatDashboard und skaliert

- [x] Soll-Temperatur: Wertebereich aus den Set-Befehlen des Geräts (CUL_HM `desired-temp`), sonst 5–30 °C; 0,5-Schritte, Senden nach 1,5 s.
- [x] Betriebsart wählbar (CUL_HM `controlMode`, MAX `desiredTemperature auto|eco|comfort|boost|manual`); nur wenn das Gerät den Befehl anbietet. Strikter Client-Befehl `setCommand` (Name und Wert validiert).
- [x] Thermostat- und Wert-Kachel skalieren ihren Inhalt über Container-Einheiten; bei kleiner Kachel entfallen erst Ventil, dann Batterie/Modus, zuletzt Schieber.
- [x] Wert-Anzeige hat einen optionalen Titel; alle Widget-Dialoge zeigen den Alias des gewählten Devices (Regeln 10/11 in ENTWICKLUNG.md).
- Ventil und Batterie (mit Fallback auf Kanäle) waren bereits vorhanden.

## Widget-Ausbau (angelehnt an FTUI)

Alle Stories sind **Entwurf** und werden vor der Umsetzung besprochen. Gemeinsame Regeln für jedes neue Widget: Regeln 1–12 in `ENTWICKLUNG.md` (Titel, Alias, Skalierung, Top-Ausrichtung), einheitliches Skalierverhalten nach K02, schreibende Aktionen nur über validierte Namen und Werte (wie `setCommand`), strenges Schema samt Tests.

### S31 - Freies HTML-Widget mit Platzhaltern (umgesetzt, Prüfung offen)

**Ziel:** Eigener HTML-Code in einer Kachel, der Live-Werte aus FHEM einbindet.

- [x] Widget `fhem-html`: Textfeld für HTML/CSS im Konfigurationsdialog.
- [x] Sicherheit: Der Code wird bereinigt (Positivliste von Tags und Attributen, kein `script`, keine `on...`-Handler, keine `javascript:`-URLs, keine fremden Ressourcen ohne Freigabe) und im Shadow-DOM der Kachel gerendert, damit Stile die Seite nicht verändern.
- [x] Platzhalter, die live aktualisiert werden, zum Beispiel `{{Device:reading}}` (Wert), `{{Device:reading|unit}}`, `{{Device:alias}}`, `{{Device:state}}`; Format-Filter wie `|round(1)`; Zugriff nur auf Devices, die der Konfiguration bekannt sind. Genauer Satz wird in der Story festgelegt.
- [x] Filter: `round(n)`, `int`, `upper`, `lower`, `default`, `prefix`, `suffix`, `map`. Bedingte Darstellung, zum Beispiel Attribut `data-cms-class-if="Device:reading=on:aktiv"`, damit sich Farben und Icons je nach Zustand ändern, ohne Skript.
- [x] Hilfe: Link „Platzhalter-Hilfe“ im Dialog öffnet eine Seite (`docs/PLATZHALTER.md`, auch als Hilfetext im Dialog) mit Syntax, Device einbinden, Reading holen, Beispielen und Grenzen.
- [ ] Skalierung nach K02: bisher feste Basisschrift `1rem`, Inhalt oben ausgerichtet, Überlauf scrollt; die einheitliche Skalierung folgt mit K02.
- [ ] Schaltaktionen aus dem freien HTML (z. B. `data-cms-set`) bleiben offen; sie folgen nach S32/S33 mit denselben validierten Namen und Werten.

### S32 - Schalter (an/aus) (umgesetzt, Prüfung offen)

- [x] Widget `fhem-switch` wie `ftui-switch`: Device, Reading für den Zustand, Befehle für an/aus (Auswahl aus den Set-Befehlen), Titel, optionales Icon je Zustand; Klick sendet `set <Device> on|off`.
- [ ] Offen: abweichende Zustandswerte (z. B. Reading `ON` bei Befehl `on`), Befehle mit Parameter.

### S33 - Taster / Befehlsknopf (umgesetzt, Prüfung offen)

- [x] Widget `fhem-button` wie `ftui-button`: Beschriftung, Icon, ein fester, aus den Set-Befehlen des Devices gewählter Befehl (z. B. `on`, `toggle`, `up`); keine freien Befehle.

### S34 - Schieberegler (Entwurf)

- [ ] Widget `fhem-slider` wie `ftui-slider`: Device, Set-Befehl und Bereich aus der Set-Beschreibung (`slider,min,step,max`), Anzeige des Werts, Senden nach kurzer Verzögerung (wie beim Thermostat).

### S35 - Auswahlliste (Entwurf)

- [ ] Widget `fhem-select` wie `ftui-select`: Werte aus den Set-Optionen des Devices, Darstellung wie der Modus-Knopf des Thermostats.

### S36 - Status-Symbol (umgesetzt, Prüfung offen)

- [x] Widget `fhem-icon`: Device und Reading auswählen; pro Reading-Wert ein Icon aus der FHEM-Bibliothek und eine Farbe zuordnen.
- [x] Nur lesend; nicht zugeordnete Werte erscheinen als Text. Schema und Zuordnungen werden serverseitig streng validiert.
- [ ] Anzeige und Icon-Lesbarkeit auf der FHEM-Testinstanz prüfen.

### S37 - Bild / Kamera (Entwurf)

- [ ] Widget `fhem-image-live` wie `ftui-image`: Bild-URL (aus Reading oder fest), optionales Aktualisierungsintervall; Quelle nur über erlaubte Hosts (Vertrauensgrenze noch festzulegen).

### S38 - Uhr / Datum (umgesetzt, Prüfung offen)

- [x] Widget `fhem-clock` mit digitaler Uhr, digitaler Uhr mit Datum und Analoguhr; Sekunden, Datum und Wochentag optional.
- [x] Lokale Browserzeit; Schema validiert Darstellungsart und boolesche Optionen.
- [ ] Darstellung und Skalierung auf FHEM-Testinstanz prüfen.

### S39 - Anzeigeinstrumente: Fortschrittsbalken, Gauge, Rundregler (Entwurf)

- [ ] Widget `fhem-gauge` wie `ftui-gauge`/`ftui-progress`: Wert in einem Bereich (min/max, Farbverlauf) als Balken oder Halbkreis; später ein schreibender Rundregler wie `ftui-knob`.

### S40 - Diagramm (Entwurf)

- [ ] Widget `fhem-chart` wie `ftui-chart`: Verlauf eines Readings aus FileLog oder DbLog; eigene Story mit Sicherheits- und Performancebetrachtung (Datenmenge, nichtblockierend).

### S41 - Readingsgroup / Tabelle (Entwurf)

- [x] Widget `fhem-table` zeigt mehrere frei kombinierbare Devices und Readings in einer kompakten Tabelle.
- [x] Werte werden aus den Live-Snapshots aktualisiert; Schema begrenzt und validiert Zeilen, Device- und Reading-Namen.
- [ ] Darstellung und Live-Aktualisierung auf FHEM-Testinstanz prüfen.

### S42 - Link und Popup (Entwurf)

- [ ] Widget `fhem-link` wie `ftui-link`/`ftui-pagebutton`: Kachel, die eine CMS-Seite oder eine externe URL öffnet.
- [ ] Popup: Kachel öffnet beim Klick eine weitere Kachel-Gruppe als Dialog (wie `ftui-popup`).

### S43 - Badge (Entwurf)

- [ ] Kleiner Zähler/Status-Punkt auf einer anderen Kachel oder in der Navigation (wie `ftui-badge`).

### S44 - Wetter, Abfahrtszeiten (Entwurf, später)

- [ ] Widgets `fhem-weather` und `fhem-departure` wie in FTUI; brauchen externe Datenquellen und deshalb zuerst eine Entscheidung zur Vertrauensgrenze.

### S45 - Platzhalter suchen und im Textbaustein verwenden (umgesetzt, Prüfung offen)

**Ziel:** FHEM-Werte lassen sich im freien HTML und im Textbaustein ohne Syntaxkenntnis einsetzen; der Textbaustein bleibt ein formatierter Text mit Bildern und Tabellen.

- [x] Gemeinsamer Dialog „Platzhalter suchen“ (`js/placeholder-picker.js`): Device suchen (Name, Alias, Typ, Raum), Reading aus Liste wählen oder eintippen (`@alias`, `@name`, `@type` inklusive; Kanäle werden mit angeboten), optionaler Filter mit Vorschlagsliste, Vorschau des aktuellen Werts.
- [x] Freies HTML: Knopf „Platzhalter suchen und einfügen“ setzt `{{Device:reading|filter}}` an der Cursorposition ein, wahlweise als Element im FTUI-Stil (`<span device=… reading=…>`). Im Code bleibt der Platzhalter normaler Text; der Dialog sucht und fügt nur ein.
- [x] Textbaustein: Platzhalter stehen an beliebigen Stellen (Absatz, Überschrift, Tabelle, Liste, fett/farbig) und werden live ausgewertet. Gespeichert wird `{{Device:reading|filter}}` im Text; Server und Schema bleiben unverändert (höchstens 20 verschiedene Devices je Text).
- [x] Im Bearbeitungsmodus des Textbausteins ist ein Platzhalter ein unteilbarer Baustein (Chip) in der Werkzeugleiste „{{ }}“ eingefügt; ein Klick darauf öffnet den Dialog zum nachträglichen Bearbeiten, Entf löscht ihn.
- [x] Textbaustein erhält Live-Daten (Abo auf die Devices im Text, Anzeige „veraltet“ bei Verbindungsproblemen).
- [ ] Offen: Platzhalter in Links und Bildbeschreibungen, Eingabe per Tastatur (Chip ohne Maus bearbeiten).

### S46 - Freieres, feineres Layout (48-Spalten-Raster beschlossen)

Am 04.11.2026 wurde Option A gewählt: 48 Spalten mit kleineren Zellen; das Schema behält `col/row/w/h`. Migration aus Schema-Version 2 skaliert die Spaltenposition und -breite, sodass bestehende Layouts ihre Position und Grösse behalten. Freie Positionen und feste Designflächen sind nicht Teil dieser Änderung. Die Darstellung auf Tablet und Smartphone ist im Review zu prüfen. Gemeldet am 2026-10-31.

## Buglist

Gemeldete Fehler, die noch besprochen werden. Noch nicht umgesetzt.

- **B01 - Wert-Anzeige skaliert nicht richtig.** Gemeldet am 2026-10-31.
- **B02 - Wert-Anzeige zeigt den Titel nicht an**, obwohl einer eingetragen ist. Gemeldet am 2026-10-31.
- **B03 - Thermostat-Kachel: unten viel ungenutzter Leerraum.** Der Platz wird nicht benötigt; Inhalt und Kachelhöhe sollen besser zusammenpassen (Screenshot vom 2026-10-31, Kacheln im Layout-Modus). Gemeldet am 2026-10-31. **Umgesetzt (Prüfung offen):** hohe Kacheln schalten auf einspaltiges Layout und füllen die Höhe.

- **B04 - Safari skaliert die Schrift größer als Edge.** Ab 125 % Zoom werden Thermostat-Kacheln in Safari unten abgeschnitten, Schrift wirkt dort größer. Ursache offen (kein WebKit zum Testen). Schieberegler wurde vereinheitlicht (grün). Schriftgröße des Thermostats wird jetzt per JS (ResizeObserver) aus der Kachelgröße berechnet, mit Fit-Prüfung; **Umgesetzt (Prüfung in Safari offen).** Gemeldet am 2026-10-31.
- **K01 - Browser-Zoom.** Raster und Inhalte sollen sich beim Ändern der Browser-Seitenskalierung (Zoom) flüssig anpassen. Entschieden: Breite und Höhe folgen beide dem Zoom, einspaltig ab ca. 40 rem (später Burgermenü, S28). **Umgesetzt (Prüfung offen):** Spaltenabstand und Zeilenhöhe in `cqw`.
- **B05 - Safari-Kompatibilität (Sammelthema).** Edge funktioniert wie gewünscht, Safari nicht. Bekannt: Platzhalter im Textbaustein brechen die Zeile um und nehmen keine Formatierung an (B-Fix `697a1f2` greift in Edge; in Safari weiterhin fehlerhaft), dazu B04 und K01. Verdacht: `getSelection` im Shadow DOM (Safari kennt kein `shadowRoot.getSelection`, nötig wäre `getComposedRanges`) und `contenteditable=false`-Spans in Safari. Aufgabe: Ursachen einzeln eingrenzen und eine Safari-Prüfliste für alle Widgets führen. **Offen (Backlog).** Gemeldet am 2026-10-31.
- **K02 - Einheitliches Skalierverhalten aller Widgets (Konzept).** Thermostat, Wert-Anzeige und alle künftigen Widgets sollen sich beim Skalieren gleich anfühlen und gleich aussehen. Idee: gemeinsame Hilfe (Basisklasse oder Modul) für Schriftberechnung per `ResizeObserver` samt Fit-Prüfung, gemeinsame Abstände, Titel-Label, Rahmen und Zahnrad. Bisher hat jedes Widget eigene Formeln (Thermostat per JS, Wert-Anzeige per CSS). Gemeldet am 2026-10-31, wird bei Gelegenheit besprochen.

## Später prüfen - Erweiterungen außerhalb des MVP

Diese Themen werden nach dem MVP priorisiert. Wenn sie aufgenommen werden, entstehen dafür eigene Stories am Ende der Liste.

- Schreibende Widgets und FHEM-Befehle nach separater Sicherheitsfreigabe.
- Kalender-, Wetter- und RSS-Komponenten einschließlich externer Vertrauensgrenzen.
- Plugin-Vertrag, Versionskompatibilität und Isolation von Drittanbieter-Code.
- Charts, weitere Widgettypen, Themes und zusätzliche Layoutfunktionen.
