# Story- und Aufgabenliste

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
- [x] Die erste wiederverwendbare Web Component `cms-device-card.js` erstellen und in das Testfrontend integrieren.
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

- [ ] Testfälle für Berechtigungen, ungültige Daten, Neustart und Verbindungsabbruch ausführen.
- [ ] Browser-, Tastatur- und Touch-Bedienung auf den vereinbarten Zielgeräten prüfen.
- [ ] Die Phone-/Tablet-Referenzmodelle vor Testbeginn festlegen und zusammen mit Browser-Version und Ergebnis protokollieren.
- [ ] Performance und Serverlast mit den S01-Messbedingungen bewerten.
- [ ] Installations-, Konfigurations- und Fehlerbehebungsdokumentation für Anwender erstellen.
- [ ] Abweichungen und Folgestories am Ende dieser Liste ergänzen.

**Akzeptanzkriterien**

- Alle MVP-Kriterien aus `ENTWICKLUNG.md` sind nachweislich erfüllt oder Abweichungen sind ausdrücklich akzeptiert und dokumentiert.
- Tests und Installationsschritte sind für Entwickler nachvollziehbar.
- Der Stand ist erst nach ausdrücklicher Freigabe zur Veröffentlichung auf `main` vorgesehen.

## Später prüfen - Erweiterungen außerhalb des MVP

Diese Themen werden nach dem MVP priorisiert. Wenn sie aufgenommen werden, entstehen dafür eigene Stories am Ende der Liste.

- Bild-Uploads und Medienverwaltung mit Dateityp-, Größen- und Speicherregeln.
- Schreibende Widgets und FHEM-Befehle nach separater Sicherheitsfreigabe.
- Kalender-, Wetter- und RSS-Komponenten einschließlich externer Vertrauensgrenzen.
- Plugin-Vertrag, Versionskompatibilität und Isolation von Drittanbieter-Code.
- Charts, weitere Widgettypen, Themes und zusätzliche Layoutfunktionen.
