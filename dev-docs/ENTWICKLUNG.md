# Entwicklungsdokumentation

Diese Dokumentation richtet sich an Entwickler und KI-Agenten. Sie ist nicht für die Auslieferung an FHEM-Anwender bestimmt. Sie ist der zentrale Informationsraum für Projektziel, Anforderungen, technische Entscheidungen und Entwicklungswissen. Anforderungen dürfen und sollen hier im Entwicklungsverlauf ergänzt und angepasst werden.

Die bekannten, nach Abhängigkeiten geordneten Umsetzungsstories stehen in der [Story- und Aufgabenliste](./STORIES.md). Diese Dokumentation beschreibt das Zielbild und die Anforderungen; die Storyliste verfolgt deren schrittweise Umsetzung.

## Führendes Zielbild und bisheriger Stand

Für neue CMS-Entwicklungen und das Refactoring ist die
[Entwicklerdoku und der Styleguide](./entwicklerdoku_und_styleguides.md) führend.
Bei abweichenden Architektur- und Gestaltungsvorgaben in dieser Datei gilt das
neue Dokument als Ziel. Die nachfolgenden Beschreibungen dokumentieren teilweise
den bisherigen oder einen früher geplanten Stand; sie sind kein Nachweis, dass das
neue Ziel bereits umgesetzt ist. Übergang, Datenmigration und abweichendes Verhalten
werden vor der jeweiligen Umsetzung geklärt und in den Issues festgehalten.

Die hier dokumentierten Sicherheits-, Test-, Branch- und Freigabeverfahren bleiben
verbindlich. Insbesondere bleiben bestehende Daten und die beiden
[Platzhalter-Schreibweisen](../docs/PLATZHALTER.md) erhalten; Codebeispiele des
Styleguides ersetzen keine Validierung, Berechtigungsprüfung oder CSRF-Sicherung.

## Ausgangsbasis für das FCUI-Refactoring

Der Git-Tag `before-fcui-refactoring` bezeichnet den vollständigen
CMS-Repository-Stand auf `dev` vor dem Umbau (Commit `0253d7d`). Die folgende
Bestandsaufnahme beschreibt diesen Stand und ist keine Zusicherung einer
abgeschlossenen Geräteabnahme. Historische Testergebnisse und offene Prüfungen
stehen in [ABNAHME.md](./ABNAHME.md).

| Bereich | Bestand vor dem Refactoring |
|---|---|
| Einstieg und Assets | `FHEM/01_FHEMCMS.pm` erzeugt je Device `www/fhem-cms/<Device>/index.html`; gemeinsame CSS- und ES-Module werden über FHEMWEB ausgeliefert, einschließlich Cache-Busting. |
| Seiten und Navigation | JSON-Seiten, Hash-Routing und ein globales, im Raster platzierbares Navigations-Widget; Seitenverwaltung im Bearbeitungsmodus. |
| Widgets | Thermostat, `fhem-value`, `fhem-clock`, `fhem-icon`, `fhem-table`, `fhem-slider`, `fhem-switch`, `fhem-button`, `fhem-html`, `text`, `fhem-chart` und `fhem-solarflow`. Diagramme nutzen historische Daten; SolarFlow liest mehrere Werte. |
| Bearbeitung | Texteditor und Medien, Widget-Dialoge, eigenes Raster mit Ziehen und Größenänderung; Entwurf, Vorschau, Veröffentlichen und Verwerfen sind getrennt. |
| Darstellung | Dark-/Light-Theme, responsives Layout und 48-spaltiges Raster; auf schmalen Ansichten einspaltig. |
| Daten und Aktionen | `FhemClient` nutzt FHEMWEB-Sitzung und CSRF für Abfragen und erlaubte Schreibbefehle; WebSocket-Inform löst Refreshes aus, Polling dient als Rückfall. |
| Speicherung | Je Device `fhem-cms-data/<Device>/config.json`, optional `draft.json` und konfigurierte Backups; Medien unter `www/fhem-cms/<Device>/media/`. Schema 4; ältere Schema-Versionen 1–3 werden beim Lesen migriert. |
| Platzhalter | `{{Device:reading|filter}}` in Text und freiem HTML; die `device`-/`reading`-Elementvariante zusätzlich im freien HTML. Details und Grenzen: [PLATZHALTER.md](../docs/PLATZHALTER.md). |

### Abweichungen und Abhängigkeiten

- Der Styleguide gibt Lit/TypeScript bzw. ESM und ein Bundle vor; der Bestand
  verwendet native Web Components und einzelne JavaScript-Module.
- Gridstack mit 12 Spalten ersetzt nicht automatisch das bisherige 48-Spalten-Raster:
  Eine verlustfreie Behandlung nicht passend ausgerichteter Positionen muss erst
  entschieden und getestet werden.
- Die vorgesehenen App-Shell-Modi und das Navigations-Widget unterscheiden sich
  von der bestehenden Raster-Navigation. Das bestehende Seitenrouting und
  gespeicherte Layouts sind beim Übergang zu berücksichtigen.
- Der zentrale Pub/Sub-Controller ist Zielbild; bisher liefert FHEMWEB Inform-Hinweise,
  woraufhin der Client Zustände erneut liest. Sicherheits-, Reconnect- und
  Fallback-Verhalten dürfen nicht stillschweigend entfallen.
- Light DOM und freies HTML dürfen die bestehenden serverseitigen und clientseitigen
  Prüfungen nicht umgehen. Die Styleguide-Beispiele für Befehle und externe Assets
  sind keine Freigabe ungeprüfter Befehle oder einer CDN-Pflicht.
- #58 beschreibt den Dokumentationsabgleich. Für Transport, Sicherheit, Persistenz,
  Widget-Vertrag, SPA und Abnahme sind auch die bestehenden Issues #2, #3, #4, #5,
  #7 und #8 zu berücksichtigen; der Übergang wird in #59 und #65 geklärt.

### FCUI-Übergangsarchitektur

**Aktueller Entwicklungsstand:** Die Umstellung erfolgt auf ausdrücklichen
Entwicklerwunsch über einen einzigen Button `Jetzt umstellen` bzw.
`set <CMS> layoutupgrade`, ohne Vorschau, Sicherungs-Checkbox oder weitere
Bestätigung. Widgets und Konfiguration bleiben auf ihren Seiten erhalten;
Positionen und Größen dürfen vollständig neu vergeben werden. Live und ein
vorhandener Entwurf werden getrennt umgestellt und bytegenau gesichert.
Das `layout-upgrade.json`-Journal bindet die Originale über ihre Backup-Dateien.
Ein unterbrochener Auftrag wird beim Neustart fortgesetzt; bis zum Abschluss
bleiben Layout-Leseverträge und konkurrierende Konfigurationsschreibwege gesperrt.
Bei externen Änderungen wird sichtbar abgelehnt statt überschrieben.
Die internen Verträge `version5draft` und `migrationcommit` bleiben für Editor
und Restore registriert, werden aber nicht im Set-Menü angeboten.
Die folgenden Vorschau-/Entwurfssperren beschreiben den abgelösten historischen
Migrationsablauf und gelten nicht für `layoutupgrade`. Für Restore bleibt die
Entwurfssperre bestehen. Lokale isolierte Browser- und Transaktionstests ersetzen
keine FHEMWEB-/Geräteabnahme auf gesicherten Testdaten.
Ältere Stände benötigen für Rollback eine zusammengehörige Code-, Asset- und
Datensicherung.

Neue Datenverzeichnisse erhalten eine validierte Schema-5-Startkonfiguration.
Eine fehlende Live-Datei in einem bereits vorhandenen Datenverzeichnis wird
nicht automatisch ersetzt.

Der Schema-5-Editor verwendet wieder die gemeinsamen `cms-toolbar`-/`cms-menu`-
Klassen und modale Einstellungsdialoge. Nur seine Widgetansicht aktiviert
Gridstack-Drag/Resize; die Homepage bleibt statisch. Punktgriff und Eckgriff
bearbeiten die echten Widgets, das Stiftsymbol öffnet deren Konfiguration.
Nach `dragstop`/`resizestop` wird das Raster synchron `inert` gesetzt, weitere
Editoraktionen werden gesperrt und die DD-Deaktivierung/Speicherung erst nach
Gridstacks Pointer-Cleanup ausgeführt. Das vollständige Raster wird über
`saveLayout` zustandsgebunden als Entwurf gespeichert und zurückgelesen.
Vor dem Schreiben werden alle Seiten einschließlich globaler Navigation geprüft.
Bekannte Layoutfehler setzen das Raster mit sichtbarer Meldung zurück;
unklare Schreibantworten erfordern explizites Neuladen. `pagehide` verhindert
noch nicht gestartete Pointer-Schreibaktionen und unterdrückt späte Antworten.
Die Seiteneinstellungen enthalten ausschließlich Look & Feel (Theme, Rahmen
und Rasterdichte), keine Widgetauswahl, Rastervorschau oder Positions-/Größenmaske.
Widgets werden nur direkt im Editiermodus verschoben und skaliert.
Unter **Bearbeiten → Seiteneinstellungen** sind 12, 24, 48, 96 oder 192 Spalten wählbar.
Die Auswahl gilt deviceweit, bleibt in Schema 5 und skaliert alle Seiten samt
Navigation in beiden Achsen. Beim Vergröbern werden Koordinaten und Größen
gerundet; Kollisionen werden in visueller Reihenfolge nach unten aufgelöst.
Grenzüberschreitungen werden sichtbar abgewiesen. Die Auswahl wird beim Speichern
aus der unveränderten Ausgangskonfiguration umgerechnet und als Entwurf
gespeichert und zurückgelesen; Zwischenwahlen verändern keine Positionen.
Darstellung, Validierung, Hilfsraster und neue Widgetgrößen
verwenden durchgängig die gewählte Spaltenzahl.
Ein stabil reservierter Scrollbalkenplatz am Dokument verhindert eine
Resize-Schleife durch wechselnde Fensterbreiten und automatische Zellhöhen.
Die Geräte-Vorschau ist auch in diesem Editor verfügbar: Sie öffnet die aktuelle
Seite mit `?mode=preview` in einem maßgerechten Iframe, bietet Geräte- und
Desktopauflösungen an und vertauscht beim Drehen Breite und Höhe.
Homepage und Vorschau brechen Widgets anhand des benannten `cms-page`-
Inhaltscontainers um: unter 768 CSS-Pixeln zwei Teilspalten, unter 1200 vier,
darüber das unveränderte Gridstack-Raster. Bis 1/4 der gespeicherten Breite
gilt ein Widget als klein (mobil eine, Tablet eine Teilspalte); bis 1/2 belegt
es mobil zwei, auf Tablets zwei Teilspalten, darüber jeweils die ganze Zeile.
Navigation kommt zuerst, Widgets folgen im DOM nach gespeicherter Zeile/Spalte.
CSS verwendet das gespeicherte Seitenverhältnis mit 96 Pixeln Mindesthöhe;
die Navigation wächst mit ihrem Inhalt. Container-Queries reagieren auch im
gedrehten Vorschau-Iframe ohne Remount, neue Live-Abfragen oder Schreibaufrufe.
`data-responsive` und die abgeleiteten CSS-Variablen sind reine Darstellung,
kein Konfigurationsformat. Editierbare Raster bleiben davon ausgeschlossen.

Am 08.11.2026 wurde für den Rasterübergang festgelegt: **Bestehende Layouts
bleiben im 48-Spalten-Format erhalten und bearbeitbar; neue FCUI-Layouts nutzen
12 Spalten.** Nach späterer ausdrücklicher Entscheidung des Entwicklers werden
bei der bestätigten Umstellung automatisch gerundete und kollisionsfrei
angeordnete Layoutvorschläge akzeptiert; das Erscheinungsbild darf sich ändern.
Inhalte, Seiten, Medien und Widget-Konfigurationen bleiben erhalten. Ein
gespeichertes `settings.gridColumns` von 12 oder 24 ändert daran nichts: Im
Bestand sind alle gespeicherten Koordinaten trotzdem 48-Spalten-Einheiten.

Die Formatentscheidung gilt **pro CMS-Device**, nicht pro Seite: Alle Seiten
und die Navigation einer Instanz gehören derselben Layout-Engine an. Eine
Mischung alter und neuer Layoutformate innerhalb einer Instanz ist nicht
vorgesehen. Bestehende Instanzen bleiben zunächst im alten Format bearbeitbar;
neue FCUI-Instanzen sollen das neue Format verwenden. Auch bestehende Instanzen
können ausdrücklich auf das neue Format umgestellt werden.

Für den Übergang gelten folgende Anforderungen, nicht bereits implementierte
Funktionen:

1. **Daten und Kompatibilität:** Schema 1–3 bleibt über die bestehende Migration
   auf Schema 4 lesbar; Schema 4 behält seine bestehende 48-Spalten-Semantik.
   Für neue 12-Spalten-Layouts muss ein ausdrücklich versioniertes,
   serverseitig validiertes Format die Auswahl der richtigen Layout-Engine
   ermöglichen. Unbekannte Formate sind sichtbar abzulehnen. Der konkrete
   Formatvertrag und seine Implementierung gehören zu #65 und #67; allein
   `settings.gridColumns` darf nicht als Unterscheidungsmerkmal dienen.
2. **Live, Entwurf und Backup:** Live-Konfiguration, Entwurf, Medien und alte
   Backups bleiben getrennt erhalten. Laden oder Anzeigen eines Altbestands darf
   ihn nicht umschreiben. Änderungen an alten Layouts dürfen nicht implizit auf
   12 Spalten runden. Die explizite Umstellung benötigt nur einen Button;
   Validierung und geprüfte Konfigurationssicherungen laufen serverseitig.
   Navigation und alle Seiten werden einbezogen; Widgets werden deterministisch
   neu angeordnet. Live und Entwurf bleiben getrennt mit ihren jeweiligen Inhalten
   erhalten. Die Umstellung darf keinen Entwurf veröffentlichen oder verwerfen.
   Wiederherstellung muss
   das Format des Backups respektieren; ein älterer Programmstand kann ein neues
   Format möglicherweise nicht lesen, deshalb beim Rollback die dazu passende
   vollständige Datensicherung verwenden.
3. **Runtime und Auslieferung:** Lit-Komponenten und ESM-Bundle werden
   schrittweise neben den Bestandskomponenten eingeführt; Bootstrap und Assets
   bleiben über FHEMWEB installierbar. Versionierte Abhängigkeiten sollen beim
   Build bereitgestellt und mit den Assets ausgeliefert werden, statt zur
   Laufzeit ungeprüft aus einem CDN geladen zu werden. Build, Lizenzprüfung,
   Paketierung und Cache-Busting sind in #62 umzusetzen.
4. **Daten und Aktionen:** Ein zentraler Controller verwaltet Snapshots und
   Abonnements; bis zur geprüften Ablösung bleibt der FHEMWEB-Inform-Weg mit
   Snapshot-Refresh, Reconnect, Fehlerzuständen und Polling-Fallback erhalten.
   Widgets melden sich beim Entfernen ab. Aktionen nutzen weiterhin die geprüften
   FHEMWEB-Clientwege mit Session, Rechten und CSRF; das Beispiel mit
   interpoliertem `sendCmd` ist kein freigegebener Befehlsvertrag. Der Nachweis
   von Rechten und Transport bleibt in #2, #3 und #66 offen.
5. **Shell und Widgets:** Die drei FCUI-Shell-Modi werden in #63 und die
   Gridstack-Bearbeitung in #67 umgesetzt. Bestehende Navigation, Routing,
   Widgets und Platzhalter bleiben bis zu ihrem kompatiblen Ersatz nutzbar.
   Der Widget-/Binding-Vertrag und Fehlerzustände werden mit #5, #64 und #69
   abgestimmt. Bei freiem HTML bleiben serverseitige Validierung und
   clientseitige Bereinigung auch im Light DOM bestehen.
6. **Reihenfolge und Freigabe:** Architektur und Datenvertrag vor Runtime,
   Shell und Layout-Editor klären; danach Widgets und Design schrittweise
   umstellen und die Gesamtregression (#61) durchführen. Jeder Schritt erhält
   eigene Tests und eine Geräteabnahme. Abhängige Commits nur gemeinsam
   freigeben, wenn eine unabhängige Übernahme nicht sicher möglich ist;
   `main` bleibt bis zum ausdrücklichen Release-Go unverändert.

#### Sicherheitsgrenzen des künftigen Formatvertrags

- Die Konfiguration trägt ihre Formatkennung eindeutig auf oberster Ebene;
  Schema 1–3 werden wie bisher beim Lesen nach Schema 4 migriert und behalten
  dessen 48-Spalten-Semantik. Ein neues Schema für 12 Spalten ist noch nicht
  implementiert und wird derzeit abgewiesen. Koordinatenkonvention, genaue
  Schema-Version und Widget-Vertrag müssen vor der Implementierung zwischen
  #65 und #67 abgestimmt und serverseitig strikt validiert werden.
- Live und Entwurf derselben Instanz dürfen nicht unbemerkt unterschiedliche
  Layoutformate annehmen. Ein Formatwechsel ist bei vorhandenem Entwurf
  abzulehnen. Die Wiederherstellung eines Backups in einem anderen Format und
  der dabei bestehende Entwurf benötigen einen ausdrücklich geregelten,
  getesteten Ablauf; insbesondere dürfen Daten dabei nicht automatisch
  konvertiert oder verworfen werden.
- Neue Daten dürfen erst angenommen oder ausgeliefert werden, wenn die passende
  Engine einsatzbereit ist und auch veraltete oder zwischengespeicherte Clients
  sicher behandelt werden. Ein alleiniger Schema-Check im neuen Frontend reicht
  nicht: Alte Clients und alte Schreibbefehle müssen serverseitig daran
  gehindert werden, neue Daten falsch zu interpretieren oder zu überschreiben.
  Dazu ist ein getrennt versionierter Zugriffspfad oder ein gleichwertiger,
  nachweisbar sicherer Vertrag erforderlich; bei fehlender Kompatibilität
  müssen Lesen und betroffene Schreiboperationen sichtbar fehlschlagen.
- Alte und neue Assets, Device-Startseite und Backend müssen gemeinsam
  kompatibel sein; Cache, parallele Browser-Tabs und unvollständige Updates sind
  in den Tests zu berücksichtigen. Bei Rollback auf älteren Code können diese
  Schutzmaßnahmen nicht vorausgesetzt werden: Nur zusammengehörige Code-,
  Asset- und Datensicherungen auf einer isolierten Instanz wiederherstellen.

Die interne Rasteranalyse
`fcui/layout-migration.js` ermittelt für Schema 4 die exakt umrechenbaren
gespeicherten Koordinaten und markiert die übrigen Positionen und Breiten.
Sie meldet außerdem Überlappungen der gespeicherten Raster pro Seite. Sie
verändert und speichert keine Daten und ersetzt weder die serverseitige
Validierung noch die Migrationsvorschau. Ohne gespeicherte Navigation meldet sie
ausdrücklich, dass die vom Bestandsfrontend ergänzte Navigation und die
verschobenen Zeilen separat zu berücksichtigen sind. Auch abweichende effektive
Layoutmodi sind vor einer tatsächlichen Vorschau zu behandeln. Zusätzlich
berechnet `inspectEffectiveLegacyLayout` die angezeigten Positionen pro Seite
mit der bestehenden Layoutlogik, einschließlich Standardnavigation und
Zeilenverschiebung. Bei mehrdeutiger reservierter Widget-ID `__nav` wird
abgebrochen. Die berechnete Navigation kann je Seite verschieden sein und
wird nicht automatisch in die globale Navigation des Zielformats übernommen.
Die interne
Planungsfunktion akzeptiert geprüfte manuelle 12-Spalten-Positionen, meldet
noch ungelöste Positionen und Überschneidungen und speichert nichts; fehlende
Navigation und die effektive Darstellung der Modi `flow` und `masonry` werden
als offene Voraussetzungen ausgewiesen. Dies ist weder ein Formatvertrag noch
eine Freigabe zur Speicherung.

Die separate Funktion `planEffectiveLegacyLayout` plant aus den effektiv
angezeigten Positionen. Bei seitenabhängig unterschiedlichen Positionen der
Navigation verlangt sie eine explizite gemeinsame Zielposition. Nicht exakt
darstellbare Kacheln bleiben ohne manuelle Anpassung ungelöst; Zielkollisionen
werden pro Seite gemeldet. Ihre Ergebnisse ersetzen keine serverseitigen
Prüfungen und ermöglichen keine Speicherung oder Umstellung.

`suggestEffectiveLegacyLayout` erzeugt auf dieser Grundlage beim Laden einer
Vorschau automatisch vollständige Vorschläge für Navigation und alle Widgets.
Die Vorschläge werden auf 12 Spalten gerundet und kollisionsfrei platziert;
bei Platzmangel wird ein kompakter Vorschlag mit einer Zeile Höhe verwendet.
Die ursprünglichen Daten bleiben unverändert. Einzelne Positionen können in
der Vorschau angepasst oder auf den automatischen Vorschlag zurückgesetzt werden.
Die Serverprüfung und die ausdrückliche Bestätigung bleiben obligatorisch.

Die separate Seite `fhem-cms/examples/migration-preview.html` ermöglicht eine
schreibfreie geometrische Vorschau einer ausgewählten Schema-4-JSON-Datei oder
der Live-Daten eines angegebenen CMS-Devices. Sie zeigt die Navigation und
Widget-IDs; gespeicherte Konfigurationen lassen sich als reiner Text aufklappen,
die anfängliche Rastervorschau führt keine Widgets aus. Nur beim Laden eines
CMS-Devices kann der vollständige Positionsplan über
`get <CMS> migrationpreview <Base64-JSON>`
serverseitig geprüft werden; der dabei erneut gelesene Live-Stand muss mit dem
angezeigten Stand übereinstimmen. Bei vorhandenem Entwurf wird die Prüfung
abgelehnt. Eine lokale JSON-Datei wird weiterhin nur geometrisch analysiert.
Für das Laden nutzt sie `get <CMS> migrationstate`: Der Befehl liest die
validierte Live-Konfiguration nur bei fehlendem Entwurf und erzeugt kein
Datenverzeichnis. Auch `migrationpreview` erzeugt kein Datenverzeichnis.
Ein vorhandener oder als Symlink angelegter Entwurf sperrt beide Befehle.
Nach erfolgreicher Serverprüfung kann das geprüfte Zielraster zusätzlich mit
Gridstack angezeigt werden. Es enthält nur Navigation und Widget-Bezeichnungen,
keine ausgeführten Widgets oder Live-Werte. Bei Positionsänderungen oder einem
erneuten Prüflauf wird diese Anzeige verworfen; ein Seitenwechsel zeigt dieselbe
geprüfte Konfiguration für die gewählte Seite. Fehler beim Laden von Gridstack
oder Änderungen der Positionen durch Gridstack werden angezeigt.
Zusätzlich kann nach der Serverprüfung eine schreibfreie Widget-Ansicht des
Kandidaten geöffnet werden. Sie liest einmalig Snapshots der verwendeten
Devices; Diagramme dürfen Verlauf lesen und Medien/Icons werden vom Server
geladen. Die Vorschau stellt nur eine Annäherung dar und aktualisiert Readings
nicht automatisch. Steueraktionen und Bearbeitung sind deaktiviert: Der
Widget-Bereich ist inert und die eigens begrenzten Dienste lehnen Schreibaktionen
ausdrücklich ab. Seiten- oder Devicewechsel, Positionsänderungen und erneute
Prüfung räumen Widgets und Timer auf und verwerfen verspätete Ergebnisse.
Die Ansicht belegt weder eine Freigabe zur Migration noch die fertige Oberfläche.
Vorschläge und manuelle Positionen bleiben nur bis zum Schließen der Seite im
Browser. Eine Umstellung erfolgt erst nach Serverprüfung und ausdrücklicher
Bestätigung; der Schreibpfad setzt alle Sicherungen und Prüfungen erneut durch.

Die Vorschauseite kann auch über `get <CMS> migrationbackups` vorhandene
Backup-Namen laden und mit `get <CMS> migrationrestorepreview <Backup>` den
validierten Live-Stand und das Backup der Schemata 1–5 als Text anzeigen. Die
Befehle legen kein Datenverzeichnis an und ändern keine Konfiguration. Ein
vorhandener Entwurf, ungültige Daten oder Symlinks sperren die Backup-Prüfung.
Die Zustandskennung bindet beide Dateiinhalte, ist aber keine Benutzerbestätigung
oder Autorisierung. Der versionierte Restore-Schreibpfad prüft den Zustand erneut; die Anzeige
allein ersetzt keine externe vollständige Sicherung.
Der Integrationstest `t/09_restore_client_integration.test.js` verbindet den
JavaScript-Client mit dem echten Perl-Get auf isolierten Testdateien. Er prüft
auch den Übergang vom Legacy-Positionsplan über den serverseitigen Schema-5-
Kandidaten zum Gridstack-Rastervertrag einschließlich Platzhaltern, Medienpfad
und Entwurfssperre. Der getrennte Schema-5-Lesevertrag wird mit Live und Entwurf,
geänderter Zustandskennung und gemischten Formaten ebenfalls gegen echtes Perl
geprüft. FHEMWEB, Authentifizierung und ein echter Restore werden dabei nicht
geprüft.

Die interne Perl-Funktion `FHEMCMS_PrepareLayoutMigration` erstellt aus einer
vollständig validierten Schema-4-Konfiguration und einem vollständig angegebenen
12-Spalten-Positionsplan einen Schema-5-Kandidaten im Speicher. Sie erhält
Widget-Inhalte und Reihenfolge, ergänzt bei Bedarf die bisherige Standardnavigation
und stellt den Ziel-Layoutmodus auf `grid`. Sie weist unbekannte, doppelte,
fehlende oder kollidierende Positionen und die mehrdeutige Widget-ID `__nav` ab.
Die Vorschau selbst speichert den Kandidaten nicht. Der getrennte Schreibpfad
bindet den bestätigten Kandidaten an die Live-Bytes und prüft ihn erneut.
Der Schema-5-Validierungsvertrag prüft zusätzlich die vollständigen
Widget-Daten, Navigations- und 12-Spalten-Grenzen sowie Kollisionen. Die
bisherigen Lese- und Schreibwege akzeptieren weiterhin ausschließlich Schema 4;
die neue explizite Vorschau gibt einen Kandidaten zurück, speichert ihn aber nicht.
Eine ebenfalls interne Vorschaufunktion lehnt vorhandene Entwürfe ab und bindet
die gelesenen Live-Bytes und den vollständigen geprüften Zielkandidaten an einen
SHA-256-Wert. Der Wert allein ist keine Autorisierung oder Bestätigung und
beweist keine Vorschau im Browser. Ein späterer Schreibpfad muss den aktuellen
Entwurf und beide Inhalte unmittelbar vor der Transaktion erneut prüfen.
Die über versionierte FHEM-Befehle aufgerufenen Transaktionsbausteine prüfen diese
Bindung erneut, erstellen vor dem atomaren Austausch eine exklusive,
byteweise überprüfte Sicherung und prüfen Live-Datei und Entwurf unmittelbar
vor dem Austausch nochmals. Ein vorbereiteter Restore akzeptiert validierte
Backups der Schemata 1–5, sichert den aktuellen Stand und stellt Backup-Bytes
unverändert wieder her; ein vorhandener Entwurf sperrt ihn. Die Tests verwenden
ausschließlich isolierte temporäre Verzeichnisse. Die Dateisynchronisierung und
das atomare Umbenennen ersetzen keine vollständige externe Sicherung von
Konfiguration, Medien, Modul und Assets; insbesondere sind Stromausfall und
unkoordinierte externe Dateischreiber damit nicht vollständig abgesichert.
Der interne `FHEMCMS_MigrationCommand` und die vorbereiteten JavaScript-Module
`fcui-migration-transport.js` und `fcui-migration-controller.js` verbinden
Migrations- und Restore-Vorschauen mit diesen Transaktionen. Der Controller
vergleicht die angezeigte Migrationsquelle mit der Serverantwort, hält den
geprüften Plan unveränderlich und verlangt eine ausdrückliche Bestätigung.
Nach jedem Schreibversuch, auch bei verlorener Antwort oder Fehler, ist eine
neue Vorschau erforderlich. Veraltete oder während des Ladens verworfene
Vorschauen und parallele Aktionen werden abgelehnt. Die Tests
`t/28_migration_transport.test.js` und `t/29_migration_controller.test.js`
prüfen den Vertrag mit isolierten Daten und simuliertem FHEMWEB-Transport.
Der Schreibvorgang wird anhand des anschließend erneut gelesenen Live-Stands
verifiziert; bei widersprüchlicher oder fehlgeschlagener Prüfung wird keine
Erfolgsmeldung ausgegeben. Die Bestätigung einer externen Sicherung und eine
tatsächliche FHEMWEB- und Geräteabnahme bleiben Aufgabe des Entwicklers.
Der getrennte, schreibfreie Befehl `get <CMS> version5state` validiert Live
und einen vorhandenen Entwurf als Schema 5 und liefert beide zusammen mit einer
Zustandskennung. Er weist Schema 4, gemischte Formate und beschädigte Daten ab;
die bisherigen Lesewege bleiben unverändert. Die Kennung ist keine Autorisierung.
`get <CMS> layoutformat` liefert für eine validierte Live-Konfiguration die
Layoutkennung 4 (auch für beim Lesen nach Schema 4 migrierte historische
Schemata) oder 5. Der Befehl legt keine Datenverzeichnisse an und verändert
weder Live noch Entwurf; beschädigte, unbekannte oder symbolisch verlinkte
Live-Dateien werden abgewiesen. Er prüft keinen Entwurf und ist nur eine
Momentaufnahme: Die nachfolgende formatspezifische Lese- und Schreib-API muss
den Zustand erneut prüfen und bei zwischenzeitlichem Formatwechsel scheitern.
Der Device-Einstieg fragt diesen Vertrag vor dem Start der Bestandsoberfläche ab.
Format 4 startet wie bisher, Format 5 startet die versionierte Ansicht bzw.
den Editor. Fehlgeschlagene oder unverständliche Antworten werden sichtbar
abgewiesen. Ein altes Backend ohne `layoutformat` benötigt ein
gemeinsames Update von Modul und Assets. Der Legacy-Entwurfsleser prüft bei
vorhandenem Entwurf den Live-Stand erneut und lehnt ungültige oder andere Formate
ab; damit kann ein Formatwechsel nach der ersten Abfrage keinen alten Entwurf
als aktuellen Zustand ausliefern. Für die Wiederherstellung eines beschädigten
Live-Stands bleibt der explizite Restore-Weg erhalten. Wird der Browser-Tab
während des Starts verlassen, wird der angefangene Einstieg nicht fortgesetzt.
Nach einer Rückkehr aus dem Browser-Cache lädt auch die Bestandsoberfläche die
Seite vollständig neu und prüft das Format erneut.
Das vorbereitete Modul `www/fhem-cms/js/fcui-schema5-layout.js` übersetzt
Schema-5-Positionen zwischen den einbasierten Daten und Gridstacks nullbasierten
Koordinaten. Es erhält Inhalte und Seitenreihenfolge, prüft Grenzen sowie
Kollisionen einschließlich der globalen Navigation auf allen Seiten und weist
beim Initialisieren durch Gridstack veränderte Positionen ab. Die Prüfung umfasst
nur den Rastervertrag und ersetzt nicht die vollständige serverseitige
Validierung. Der Device-Einstieg verwendet das Modul für Schema 5.
Inhalte werden erst erzeugt und verbunden, nachdem Gridstack alle Positionen
übernommen hat; ein fehlerhaftes Raster startet keine Widget-Lebenszyklen.
Die bestehende Oberfläche verwendet zur Erzeugung ihrer Widget-Elemente die
gemeinsame `www/fhem-cms/js/widget-factory.js`. Sie erhält die bisherigen
Widget-Typen und Datenzuordnungen und wird auch in der optionalen Widget-Vorschau
genutzt. Sie stellt selbst keine Vorschau-Sicherheitsgrenze dar: Komponenten
können beim Verbinden Timer starten oder Dienste aufrufen; eine spätere Vorschau
muss diese Lebenszyklen und verfügbare Dienste ausdrücklich absichern.
Der vorbereitete Adapter `www/fhem-cms/js/fcui-schema5-widgets.js` verbindet
eine validierte Gridstack-Seite mit diesen Widgets und übernimmt Snapshot-Updates
und das Entfernen des Rasters. Navigation, Dienste und Snapshots werden vom
Aufrufer bereitgestellt; der Adapter führt selbst keine FHEM-Anfragen aus, aber
Widgets dürfen die übergebenen Dienste nutzen. `view-only` ist keine Schreib-
oder Netzwerk-Sperre. Der Adapter wird in der gesondert abgesicherten
Widget-Vorschau und im Schema-5-Device-Einstieg verwendet.
Beim Entfernen einer Diagrammkomponente werden laufende Verlaufsergebnisse
verworfen; beim erneuten Verbinden wird der Verlauf neu angefordert. Das
verhindert die Übernahme verspäteter Antworten nach einem Seitenwechsel.
Beim Verlassen der bestehenden Oberfläche werden ausstehende Snapshots und
Ereignisse geschlossener WebSockets verworfen; sie dürfen keine Abonnements
erneut starten. Eine vollständige Umstellung auf den zentralen FCUI-Controller
ist damit noch nicht implementiert.
Ein interner Schema-5-Entwurfsvertrag validiert Live und Entwurf gemeinsam und
verknüpft ihre tatsächlichen Bytes mit einer Zustandskennung. Ein Entwurf wird
nur gegen den unveränderten Stand atomar gespeichert; andere Schemata, ungültige
Entwürfe und veraltete Tabs werden abgelehnt. Dieser Baustein ist nicht als
FHEM-Befehl erreichbar. Interne Publish- und Discard-Bausteine verlangen dieselbe
aktuelle Zustandskennung; Publish sichert den Live-Stand vor der Übernahme.
Wird Live gespeichert, aber der Entwurf kann nicht entfernt werden, wird der
Teilzustand ausdrücklich als Fehler gemeldet. Dies ist noch kein Schutz gegenüber
unkoordinierten externen Dateischreibern und keine öffentliche API.
Der vorbereitete Browserbaustein `www/fhem-cms/js/fcui-schema5-draft.js`
führt jeweils höchstens eine Entwurfsaktion aus und verwendet die Kennung des
zuletzt gelesenen Zustands. Jede Aktion verlangt ausdrücklich die Kennung, auf
deren Stand die Bearbeitung oder Bestätigung beruht; veraltete Dialoge dürfen
auch nach einem lokalen Neuladen keine neueren Änderungen überschreiben.
Nach jedem Schreibversuch sperrt er weitere Aktionen
bis zum bestätigten erneuten Lesen; bei Fehlern, widersprüchlichem Ergebnis oder
verlorener Antwort muss ausdrücklich neu geladen werden. Er vergleicht dabei
Live und Entwurf mit dem erwarteten Ergebnis und gibt nur Kopien aus. Die
Transportfunktionen müssen vom späteren Aufrufer bereitgestellt werden; sie
sind noch nicht öffentlich angebunden. Ein Integrationstest verwendet die echten
internen Perl-Transaktionen auf isolierten Dateien, aber keinen FHEMWEB-Transport.
Ein Raster-Roundtrip wendet Gridstack-Positionen auf den aktuellen Entwurf oder
bei fehlendem Entwurf auf Live an, prüft auch seitenübergreifende Kollisionen der
globalen Navigation und speichert ausschließlich über diesen Entwurfsvertrag.
Widget-Änderungen und explizites Löschen werden ebenfalls auf einer Kopie des
aktuellen Entwurfs vorbereitet und über dieselbe Zustandssperre gespeichert;
unbekannte Seiten oder Widget-IDs beim Löschen werden abgewiesen.
Das Anlegen und Ändern eines Widgets sind ausdrücklich getrennte Aktionen:
Vorhandene IDs dürfen nicht versehentlich überschrieben werden.
Auch die deviceweite Navigation wird nur gegen die beim Öffnen verwendete
Zustandskennung und nach Rasterprüfung aller Seiten als Entwurf übernommen.
Der Controller unterstützt zudem das Anlegen, Umbenennen und Umsortieren von
Seiten sowie das Verschieben von Widgets mit expliziter Zielposition. Dabei
werden Kollisionen und doppelte Widget-IDs abgewiesen. Nur leere Seiten dürfen
gelöscht werden; vorhandene Navigationseinträge für diese Seite werden entfernt.
Dies ist weiterhin nur ein interner Baustein ohne öffentliche Oberfläche.
Der separate Rasterbearbeitungsbaustein `www/fhem-cms/js/fcui-schema5-grid-edit.js`
öffnet ausschließlich gegen die ausdrücklich angegebene aktuelle Zustandskennung
ein Gridstack-Raster mit Textbezeichnungen statt aktiver Widgets. Er prüft beim
Aktivieren, ob alle Positionen unverändert übernommen wurden, und akzeptiert
Speichern nur in der zur Konfiguration passenden 12-/24-/48-/96-/192-Spalten-Ansicht. Der explizite Speicherversuch friert
das Raster ein und nutzt die zustandsgebundene Entwurfsprüfung einschließlich
seitenübergreifender Kollisionen. Nach jedem Versuch bleibt das Raster bis zum
Schließen gesperrt; bei unklarem Fehler ist der Entwurfszustand neu zu laden.
Abbrechen entfernt nur das Raster und speichert nichts. Dieser Baustein ist
nicht an den Device-Einstieg oder eine öffentliche Schreib-API angebunden.
Zusätzlich kann ein Aufrufer eine Position mit ganzzahligen Koordinaten setzen:
Kollisionen werden vorab über alle Seiten geprüft. Verändert Gridstack dabei
weitere Positionen, wird die Bearbeitung gesperrt statt gespeichert.
Der vorbereitete Oberflächenbaustein `www/fhem-cms/js/fcui-schema5-grid-panel.js`
bietet Ziehen und numerische Eingabe sowie ausdrückliches Speichern oder
Abbrechen. Nicht übernommene Eingaben verhindern Speichern und Elementwechsel;
zwischenzeitlich veränderte Positionen müssen erneut geladen werden. Nach einem
fehlgeschlagenen Speicherversuch wird die weitere Bearbeitung gesperrt, und der
Aufrufer erhält beim Schließen einen Hinweis auf das notwendige Neuladen.
Der Baustein benötigt einen vom Aufrufer geladenen Entwurfscontroller und ist
noch nicht an die Device-Oberfläche oder einen öffentlichen Transport angebunden.
Ein automatisierter Test verbindet die Bedienoberfläche über den Controller mit
internen Perl-Entwurfstransaktionen auf temporären Dateien; das DOM und Gridstack
sind dabei Test-Stubs. Ein separater lokaler Browsertest verwendet echtes
Gridstack und einen simulierten Transport. Beide sind kein FHEMWEB- oder
Geräte-Abnahmetest.
Der vorbereitete `Schema5Editor` verbindet die Live-/Entwurfsansicht mit dem
Rasterpanel. Er zeigt an, ob Live oder Entwurf dargestellt wird, beendet vor
der Bearbeitung die bisherigen Live-Abos und lädt nach unklaren Speicherfehlern
den Zustand erneut. Beim Verlassen des Tabs wird die Ansicht beendet; ein
bereits laufender Speichervorgang kann noch abgeschlossen werden, aber kein
verspätetes Ergebnis darf die Oberfläche wieder starten. Bei Rückkehr aus dem
Browser-Cache wird die Seite vollständig neu geladen. Der Editor benötigt
weiterhin einen vom Aufrufer bereitgestellten versionierten Schreibtransport;
er ist nicht im Device-Einstieg registriert und ersetzt weder Migration noch
Restore. Die vorbereitete Seitenverwaltung kann Seiten
anlegen, umbenennen, sortieren und leere Seiten nach Bestätigung löschen.
Widgets lassen sich mit ausdrücklich angegebenem Zielraster auf eine andere
Seite verschieben; Inhalte bleiben erhalten, Kollisionen werden abgewiesen.
Jede Änderung wird getrennt mit Zustandskennung als Entwurf gespeichert;
andere noch nicht gespeicherte Eingaben blockieren die Aktion. Beim Schließen
solcher Eingaben wird nachgefragt. Fehlerhafte oder veraltete Schreibvorgänge
sperren weitere Änderungen bis zum Neuladen. Ein Integrationstest verwendet
echte interne Perl-Transaktionen auf temporären Dateien, während ein lokaler
Browsertest die Oberfläche mit simuliertem Transport prüft.
Der vorbereitete Widget-Dialogvertrag `Schema5WidgetSession` bindet eine
einzelne Aktion an Seite, Widget-ID, Typ, Raster und die beim Öffnen angezeigte
Zustandskennung. Er ersetzt nur die Widget-Speicher- und Löschdienste; die
übrigen vom Aufrufer übergebenen Dienste bleiben unverändert und stellen keine
Sicherheitssperre dar. Mehrfachaktionen und veränderte Identität oder
Rasterposition werden abgewiesen. Beim Schließen wird die Bearbeitung
ungültig; ein bereits begonnener Schreibvorgang darf noch abgeschlossen werden,
sein Ergebnis darf aber die geschlossene Oberfläche nicht erneut öffnen.
Aufrufer müssen dafür auch nach Erhalt des Ergebnisses ihren eigenen
Oberflächen-Lebenszyklus prüfen; ein bereits aufgelöstes Ergebnis lässt sich
durch nachträgliches Schließen nicht zurückziehen.
Fehler und veraltete Dialoge erfordern einen neuen Zustand und eine neue
Dialogsession. Das vorbereitete Widgetpanel verbindet diesen Vertrag mit den
Bestandsdialogen: Widgets der angezeigten Seite können angelegt, bearbeitet und
nach der jeweiligen Dialogbestätigung gelöscht werden. Neue Widgets erhalten
eine auf der Seite eindeutige Widget-ID und eine freie Startposition unterhalb des bestehenden
Rasters; wenn dort kein Platz bleibt, wird das Anlegen sichtbar abgewiesen.
Der Rastereditor kann die Position später ändern. Während des Dialogs werden
die Widget-Kachel und Geräteaktionen über `setCommand` und `setTarget` gesperrt;
andere übergebene Dienste bleiben verfügbar und sind keine allgemeine
Sicherheitsgrenze. Laufende Schreibvorgänge sperren den Dialog und dürfen bei
Tabende zwar abgeschlossen werden, aber die Ansicht nicht wieder öffnen.
Die Tests verwenden auch interne Perl-Transaktionen auf temporären Dateien.
Ein lokaler Browsertest öffnete alle zwölf Bestandsdialoge und prüfte Anlegen,
Abbrechen und HTML-Speichern mit simuliertem Transport. Das Panel ist noch nicht
mit dem Device-Einstieg oder einem öffentlichen Schreibtransport verbunden.
Das vorbereitete Navigationspanel bearbeitet Ausrichtung sowie optionale
Beschriftungen und Pixelgrößen der Seiteneinträge. Die Rasterposition bleibt
unverändert; sie wird getrennt im Rastereditor bearbeitet. Nicht gespeicherte
Eingaben erfordern beim Schließen eine Bestätigung. Gespeichert wird über die
angezeigte Zustandskennung; ein Fehler sperrt die Bearbeitung bis zum Neuladen.
Ein Test nutzt echte interne Perl-Entwurfstransaktionen auf temporären Dateien.
Das vorbereitete Darstellungspanel speichert Theme und Rahmenanzeige über den
zustandsgebundenen Entwurfsvertrag. Nicht geänderte optionale Werte bleiben
unverändert, und nicht gespeicherte Eingaben erfordern eine Bestätigung beim
Schließen. Der Editor zeigt die Einstellungen des angezeigten Live- oder
Entwurfsstandes an und stellt vorherige Darstellungsattribute beim Stoppen oder
Verlassen wieder her. Auch hier sperren unklare Fehler bis zum Neuladen;
isolierte Tests prüfen echte Perl-Transaktionen und das Verwerfen des Entwurfs.
Der vorbereitete Editor bietet
das ausdrückliche Veröffentlichen und Verwerfen eines angezeigten Entwurfs
nach einer Bestätigung und gegen dessen Zustandskennung. Verlorene Antworten
und veraltete Zustände sperren beide Aktionen bis zum ausdrücklichen Neuladen.
Ein Integrationstest prüft diese Abläufe mit echten internen Perl-Transaktionen
und bytegenauem Live-Backup in einem temporären Verzeichnis; FHEMWEB und DOM
werden dabei simuliert.
Ein lokaler Browsertest mit echtem Gridstack hat Ziehen und Speichern gegen
einen simulierten Transport geprüft; der automatisierte Integrationstest nutzt
isolierte Perl-Transaktionen und Gridstack-Stubs. Beides ersetzt keinen
FHEMWEB- oder Geräte-Abnahmetest.
Der Entwurfscontroller selbst bietet weder eine Oberfläche noch einen
öffentlichen Schreibweg.
Der vorbereitete Transport `fcui-schema5-transport.js` und der interne
Perl-Vertrag `FHEMCMS_Version5DraftCommand` vereinbaren eine getrennte
`version5draft`-Aktion mit Zustandskennung und Base64-JSON für Speichern sowie
zustandsgebundenes Veröffentlichen und Verwerfen. Der interne Vertrag prüft
Parameter, Größe, kanonisches Base64 und JSON und verwendet die bestehenden
Transaktionen. Ein Test verbindet den echten FHEM-Client über einen simulierten
FHEMWEB-Transport mit diesen internen Perl-Funktionen auf isolierten Dateien,
einschließlich veralteter Zustände, verlorener Antworten und Live-Backup.
Die vorbereitete Factory `createSchema5Editor` verbindet den Editor mit diesem
Transport und verlangt getrennte Clients für Entwurf und Live-Abonnements.
Beide müssen auf denselben FHEMWEB-Endpunkt und dasselbe CMS-Device zeigen.
Die gemeinsamen Widgetdienste werden für Altbestand und vorbereiteten
Schema-5-Editor über `widget-services.js` zusammengestellt. Die Factory stellt
ohne eigene Dienstauswahl Geräte-, Icon-, Medien-, Verlaufs- und Aktionsdienste
bereit; direkte Widget-Speicheraufrufe außerhalb der Dialogsession werden
abgewiesen. Geräte- und Iconlisten werden wie im Bestand zwischengespeichert;
fehlgeschlagene Leseversuche können wiederholt werden.
Ein weiterer Integrationstest verbindet die Editorbedienung mit FHEM-Client,
simuliertem FHEMWEB und internen Perl-Transaktionen auf isolierten Dateien;
er prüft unter anderem veraltete Tabs, Bestätigungsabbruch, Antwortverlust
nach Veröffentlichung und ein bytegenaues Backup. DOM und Gridstack sind
dabei Stubs, keine vollständige Browser- oder FHEMWEB-Abnahme.
Der Set-Befehl `version5draft` ist registriert; die Tests ersetzen keine
Prüfung mit echtem FHEMWEB und vollständiger Oberfläche.
Die interne JavaScript-Funktion `migrationPositions` formt nur vollständig
aufgelöste, kollisionsfreie Ergebnisse der effektiven Vorschau in diesen
Positionsplan um; sie speichert und überträgt ihn nicht.
Der vorbereitete `Schema5LivePage`-Baustein verwaltet für eine Seite Snapshots
über den bestehenden FHEMWEB-Client: Inform-Hinweise und Wiederverbindung lösen
einen gebündelten Refresh aus, alle 30 Sekunden wird zusätzlich abgefragt.
Kanalnamen werden nach einem Snapshot neu abonniert; fehlgeschlagene Abfragen
zeigen den Fehler und behalten bekannte Werte mit Veraltungszeitpunkt.
Nach dem Stop werden Timer, Abos und verspätete Ergebnisse verworfen.
Der Baustein benötigt einen eigenen Client, da dessen Subscription beim Wechsel
und Stop ersetzt beziehungsweise abgemeldet wird.
Der Live-Baustein wird von der vorbereiteten `Schema5View` mit Raster, Widgets
und bestehendem Hash-Seitenrouting verbunden. Beim Seitenwechsel beendet sie
zuerst das alte Abo und Raster; verspätete Ergebnisse dürfen die neue Seite
nicht verändern. Fehler und veraltete Werte werden sichtbar angezeigt. Die
Ansicht beendet beim `pagehide` auch Widget-Lebenszyklen und Abos. Nach einer
Wiederherstellung aus dem Browser-Cache veranlasst sie ein vollständiges
Neuladen, damit keine möglicherweise veraltete Formatkonfiguration weiterläuft.
Dieser Mechanismus ist bisher nur mit synthetischen Browserereignissen getestet.
Die Ansicht erhält einen exklusiven Client und Widget-Dienste vom Aufrufer; sie ist
keine Schreibsperre. Beide Bausteine werden nur im synthetischen Bibliothekstest
verwendet, nicht im Device-Einstieg oder in der schreibfreien Migrationsvorschau.
Sie sind weder eine vollständige Oberfläche noch der angestrebte zentrale
Pub/Sub-Controller.
Ein Integrationstest verbindet den echten Perl-Lesevertrag über den
FHEM-Client mit dieser Ansicht und prüft auf isolierten Dateien getrennte
Live- und Entwurfsdaten sowie unveränderte Quelldateien. Gridstack, DOM und
Gerätesnapshots sind dabei Test-Stubs; ein echter FHEMWEB- oder Browsertest
ist dies nicht.
Ein weiterer Integrationstest führt auf isolierten Testdateien Vorschau,
interne Migration und Neustart, versioniertes Lesen und Anzeigen, Entwurf,
Publish und formatübergreifenden internen Restore als zusammenhängende Kette
aus. Er prüft alte Schreibbefehle und veraltete Zustandskennungen, beide
Platzhaltervarianten, Medienbytes und Backup-Inhalte. Die internen
Schreibfunktionen werden dabei nur vom Test direkt aufgerufen; sie sind nicht
als FHEM-Befehle freigeschaltet. DOM, Gridstack, Gerätesnapshots und Transport
bleiben Test-Stubs; dies ersetzt weder eine vollständige Oberfläche noch
die Abnahme auf einer gesicherten FHEM-Testinstanz.
Die bisherigen Schreibbefehle prüfen vor Änderungen die Schema-Version von
Live- und gegebenenfalls Entwurfsdatei. Bei einem unbekannten Format lehnen sie
auch Verwerfen und Restore ab, statt Daten mit einem älteren Client zu ersetzen.
Bei beschädigtem JSON bleiben explizites Verwerfen und Restore möglich; der
Vorgang wird protokolliert. Diese Sperre ersetzt weder eine versionierte API
noch den Schutz bei einem Rollback auf älteren Backend-Code.

Das ist kein Nachweis einer vollständigen FHEMWEB-Autorisierung, Migration oder
Geräteabnahme. Insbesondere Testinstanz-Rechte, CSRF, externer Ressourcenzugriff,
Verlustfreiheit und Rollback sind vor Einsatz auf der Referenzumgebung zu prüfen.

#### FCUI-Build-Grundlage

Für die Entwicklung werden Node.js 24–26 und npm benötigt, auf dem FHEM-Server
und im Browser dagegen nicht. Nach `npm ci --ignore-scripts` erzeugt `npm run
build` aus den durch `package-lock.json` festgelegten Abhängigkeiten das lokale
ESM-Bundle `www/fhem-cms/js/fcui-runtime.js`, das Gridstack-CSS und die
Lizenzhinweise `www/fhem-cms/FCUI-LICENSES.txt`. `npm run build:check` prüft,
ob die eingecheckten Dateien genau diesem Build entsprechen. Externe Importe
werden beim Build abgewiesen; eingebettete Data-URLs sind erlaubt.
Die Controls-Generierung nimmt die Dateien auf, und das bestehende Cache-Token
berücksichtigt JavaScript und CSS. Bibliotheks-Updates erfolgen bewusst durch
Versionsänderung, erneuten Build und Prüfung; sie werden nicht zur Laufzeit
aus einem CDN geladen. Für das generierte JavaScript deaktiviert
`.gitattributes` die Prüfung auf Zeilenend-Leerraum: Das Bundle enthält
Leerraum innerhalb von Template-Literalen, der nicht entfernt werden darf.

Dies ist lediglich die Build-Grundlage: Der bisherige Einstieg lädt die neuen
Dateien noch nicht. FCUI-Oberfläche, Versionsvertrag und browserseitige
Integration werden in den Folgeaufgaben umgesetzt und geprüft.
Die separat aufrufbare Seite `fhem-cms/examples/fcui-check.html` prüft das
Laden der lokalen Bibliotheken mit Lit und einem 12-Spalten-Gridstack-Raster
und zeigt Ladefehler an. Zusätzlich prüft sie alle zwölf Widgettypen mit
künstlichen Snapshots, beide Platzhalterformen, die Aktualisierung und eine
explizit gesperrte Testaktion im Schema-5-Widget-Adapter. Der Live-Seitenbaustein
aktualisiert die Widgets dabei mit einem künstlichen Client; die vorbereitete
Ansicht prüft einen Seitenwechsel mit synthetischen Daten. Die verwendeten
Dienste sind Test-Stubs. Sie sendet keine FHEM-Befehle und verändert keine
CMS-Daten. Sie ersetzt nicht die Prüfung der später integrierten Oberfläche.

### Sicherung und Regression vor Umbauten

Vor Tests mit Änderungen an einer ausdrücklich freigegebenen **Testinstanz**
den vollständigen Device-Datenordner einschließlich Live-Konfiguration,
Entwurf und Backups sowie den Device-Medienordner extern und geschützt sichern.
Zusätzlich installierte Modul- und gemeinsame Frontend-Dateien samt Version sichern;
auch FHEM-Konfiguration und weitere benötigte Daten müssen nach dem Backup-Verfahren
des Betreibers gesichert werden. Ein Git-Tag enthält keine dieser Nutzerdaten.
Sicherung auf Vollständigkeit und Lesbarkeit prüfen und eine Wiederherstellung
zuerst auf einer isolierten Testkopie erproben. Kein `purge` auf Nutzerdaten.

Für einen Rollback das gesicherte Modul und die passenden gemeinsamen Assets
gemeinsam mit der **zu diesem Stand passenden** Daten- und Mediensicherung auf
einer isolierten Testinstanz wiederherstellen, FHEM neu starten und das Ergebnis
prüfen. Neuere Daten nicht ungeprüft mit altem Code öffnen oder überschreiben;
aktuellere Änderungen vorher separat sichern. Der Tag ermöglicht den Abruf des
Quellstands, ersetzt aber weder installierte Dateien noch eine Datensicherung.
Die konkrete Durchführung auf einem FHEM-System und die Freigabe erfolgen mit dem
Betreiber; die Wiederherstellung ist hier noch nicht praktisch nachgewiesen.

Für die Regression werden künstliche, nicht personenbezogene Testdaten benötigt:

1. **Live-Konfiguration:** Schema 4 mit mindestens zwei Seiten und Navigation,
   sämtlichen zwölf obigen Widgettypen und 48-Spalten-Randpositionen, darunter
   eine nicht durch vier teilbare Spalte und Breite. Ein Textbaustein enthält
   `{{TestThermostat:temperature|round(1)}}` im formatierten Text; freies HTML
   enthält diesen Textplatzhalter und ein Element mit `device` und `reading`.
   Ein weiteres Reading stammt aus einem Testkanal; Medienreferenzen zeigen auf
   künstlich erzeugte Testbilder. Testgeräte und Kommandos müssen auf der
   isolierten Testinstanz existieren.
2. **Entwurf und Backup:** Ein Entwurf mit einer gegenüber Live sichtbar
   geänderten Seite und ein Backup des ursprünglichen Live-Stands. Live und
   Entwurf müssen nach erneutem Laden unterscheidbar bleiben.
3. **Grenzfälle:** Gültige Schema-1-, -2- und -3-Beispiele sowie ungültiges JSON,
   unbekannte Felder und ein zu großes Dokument. Keine produktiven Daten oder
   echten personenbezogenen Inhalte ins Repository übernehmen.

Für spätere automatisierte Regressionstests ist folgender Umfang festgelegt:

| Prüfung | Vorgehen und erwartetes Ergebnis |
|---|---|
| Schema und Layout | Beispiele laden und erneut speichern; Seiten, Widgettypen, Einstellungen und 48-Spalten-Koordinaten bleiben erhalten. Schema 1–3 wird auf 4 migriert; ungültige Daten werden erkennbar abgewiesen. |
| Entwurf und Veröffentlichung | Live und abweichenden Entwurf lesen; Vorschau zeigt Entwurf, Ansicht Live. Veröffentlichen übernimmt den Entwurf und erzeugt ein Live-Backup. Fehlgeschlagenes Speichern oder Publish darf Live nicht überschreiben. |
| Backup und Restore | Auf isolierter Testkopie einen bekannten Live-Stand sichern, verändern und per Restore zurückholen; Werte und Medienreferenzen stimmen wieder, ein bestehender Entwurf bleibt unverändert. |
| Browser und Bindings | Beide Seiten und alle Widgets rendern; beide Platzhaltervarianten inklusive Filter zeigen dieselben erwarteten Testwerte, Änderungen aktualisieren sich. Seitenwechsel und Entfernen räumen Abos auf; Offline/Fehler und Wiederverbindung sind sichtbar. |
| Sicherheit | Unzulässiges HTML und Schemafelder werden serverseitig abgelehnt; Daten erscheinen nur als Text. Session-/CSRF- und Rechtefehler sowie unerlaubte Befehle werden erkennbar behandelt. |

Repräsentative synthetische Backend-Testbeispiele sind in
`t/02_refactoring_legacy.t` und `t/03_refactoring_migration.t` enthalten.
Automatisierte Browserprüfungen sind noch nicht erstellt; der Plan ist kein
Nachweis einer erfolgreichen Geräteprüfung.

Basisprüfung für das Backend: `prove t/01_fhemcms.t` aus dem Repository-Root.
Am 08.11.2026 lokal bestanden: 363 Tests; dabei wird ein temporäres FHEM-Umfeld
mit Stubs verwendet, keine echte FHEM-Instanz. Die Tests decken unter anderem
Schema-Migration, Validierung, Entwurf/Publish und Restore ab; sie ersetzen keine
Browser-, Berechtigungs-, Geräte- oder vollständigen Migrationsprüfungen.

Manuelle Abnahme auf einer freigegebenen isolierten Testinstanz mit zuvor
geprüfter Sicherung:

1. Live-Seiten und alle Widgets öffnen; Navigation, Randpositionen, Medien und
   beide Platzhaltervarianten mit den erwarteten Werten vergleichen.
2. Entwurf ändern und speichern: Live bleibt unverändert, Vorschau zeigt den
   Entwurf. Nach Veröffentlichen und Neuladen ist der Entwurf Live; nach Restore
   entspricht Live wieder dem gesicherten Stand.
3. Test-Reading ändern, Netzwerkverbindung unterbrechen und wiederherstellen:
   Aktualisierung, sichtbarer Offline-/Fehlerzustand und erneuter Datenstand
   müssen erkennbar sein. Schreibaktionen nur an freigegebenen Testgeräten prüfen.
4. Touch, Tastatur und Fokus sowie die Performanceziele mit 20 Widgets prüfen:
   höchstens 2 Sekunden bis bedienbar und höchstens 500 ms bis zur sichtbaren
   Reading-Änderung. Bedingungen, Messwerte und Abweichungen protokollieren.

**Referenzumgebung:** Schwerpunkt sind aktuelle Apple-iPhones und iPads mit ihren
jeweiligen aktuellen Betriebssystemen sowie Firefox, Safari, Edge und Chrome auf
macOS. Die genaue Geräteauswahl und Browser-/Betriebssystemversionen werden beim
Test dokumentiert; konkrete Modelle sind noch offen. FHEM ist in der aktuellen
stabilen Version zu prüfen; verwendete FHEM-Version und Plattform werden beim
Test festgehalten. Die unten beschriebene breitere Browsermatrix bleibt bestehen.
Ohne dokumentierte Durchführung und Messwerte ist keine Geräteabnahme erfolgt.

## Repositorystruktur

| Pfad | Zweck |
|---|---|
| `FHEM/` | FHEM-Modul und Integration |
| `docs/` | Anwenderdokumentation |
| `dev-docs/` | Interne Entwicklungsdokumentation |
| `.github/` | GitHub-Konfiguration und Copilot-Anweisungen |
| `controls_fhem-cms.txt` | Vom Workflow erzeugte FHEM-Update-Liste des gesamten installierbaren Repositories |
| `CHANGED` | FHEM-Änderungsprotokoll im Repository-Root |
| `scripts/generate_controls.py` | Erzeugt `controls_fhem-cms.txt` aus `FHEM/` und `www/fhem-cms/` |

## Branches und Freigaben

- `dev` ist der Arbeits- und Testbranch. Änderungen werden zuerst hier entwickelt und geprüft.
- `main` enthält freigegebene Stände und ist der Veröffentlichungsbranch.
- Der CMS-Branch `main` existiert bereits und enthält den Release `0.1.0`. Einen weiteren Branch gleichen Namens nicht anlegen.
- Vor einer Veröffentlichung nach `main` ist eine ausdrückliche Freigabe des Entwicklers erforderlich. Ein Auftrag für Änderungen oder Pushes nach `dev` ist keine Freigabe für `main`. Die ausdrückliche Freigabe „Go“ für einen neuen `main`-Release gilt für den zu diesem Zeitpunkt in `Ready to publish` aufgelisteten Umfang; sie ist keine pauschale Freigabe für spätere Releases.
- Nach diesem Go einen Release-Branch vom aktuellen `main` erstellen und ausschliesslich die geprüften, issuebezogenen Commits der freigegebenen `Ready to publish`-Issues darauf übernehmen. Nicht den gesamten `dev`-Branch mergen und keine Dateien als Ganzes aus `dev` kopieren. Niemals den bestehenden Branch löschen oder per Force-Push überschreiben. Ist eine unabhängige Übernahme der freigegebenen Änderungen nicht möglich, vor Änderungen an `main` anhalten und die Abhängigkeiten mit dem Entwickler klären.
- **Forumsbeitrag nach jedem `main`-Release:** Nach jedem `main`-Deploy genau einen Text mit der Beschreibung der neuen Features erstellen und dem Entwickler im Chat übergeben. Er ist die Antwort in dem fortlaufenden Forumsthread, in dem Modul und Installation bereits beschrieben sind. Deshalb nur die Neuerungen (aus dem `CHANGED`-Eintrag des Releases) mit Versionsnummer, ohne Installationsanleitung und Modulvorstellung, auf Deutsch und kompakt. Der Text ist ein Chat-Ergebnis und wird nicht im Repository abgelegt.
- Nach einer freigegebenen Veröffentlichung werden die Branches wieder synchronisiert, damit die Weiterentwicklung auf `dev` auf dem freigegebenen Stand aufsetzt.
- Die Repository-Standardeinstellung bleibt `main`, damit veröffentlichte Inhalte für Nutzer der stabile Bezugspunkt sind.

## Änderungen, Tests und Pushes

- Vor jedem Push die aktuelle Branch-Version mit `git pull --rebase --autostash` aktualisieren. Bei einem neuen Branch ohne Remote-Tracking-Branch zuerst den passenden Remote-Branch festlegen bzw. abrufen.
- Für KI-unterstützte Commits den Trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` ergänzen.
- **Issue- und Commit-Zuordnung:** Jeder inhaltliche Commit gehört genau zu einem Issue und enthält dessen Referenz `Refs #<Nr>` im Commit-Text. GitHub verknüpft damit Commit und Issue. Bei mehreren Issues in derselben Datei die Änderungen in getrennte, möglichst unabhängige Commits aufteilen (bei Bedarf gezielt hunks stagen); keine Änderung eines noch nicht freigegebenen Issues in einen Commit für ein freigegebenes Issue mischen. Änderungen ohne Issue-Zuordnung werden nicht stillschweigend einem Release zugeschlagen. Ein Issue ist nur releasefähig, wenn alle zu seinem vereinbarten Umfang gehörenden Commits bekannt und bereit sind. Sind Änderungen vermischt oder voneinander abhängig, dürfen sie nicht selektiv veröffentlicht werden: erst Commits/Umfang sauber trennen oder abhängige Issues gemeinsam abnehmen und freigeben. Kann eine sichere Trennung nicht nachgewiesen werden, Release anhalten und mit dem Entwickler klären.
- Zu Änderungen passende Tests und Syntaxprüfungen ausführen. Für Perl-Module ist mindestens `perl -c` auszuführen; gegebenenfalls benötigte FHEM-Core-Funktionen müssen in Tests geeignet bereitgestellt werden.
- `controls_fhem-cms.txt` wird vom Workflow aus allen installierbaren Dateien unter `FHEM/` und `www/fhem-cms/` erzeugt. Der repositorybezogene Name verhindert Kollisionen mit den lokal auf dem FHEM-Server abgelegten Controls-Dateien anderer Update-Quellen. Es gibt eine gemeinsame Update-Quelle für das ganze Repository, keine Controls-Dateien je Modul oder Komponente. Die Datei nicht von Hand ändern.
- Die `CHANGED`-Datei liegt im Repository-Root und wird von FHEM zusätzlich zur Controls-Datei abgerufen. Bei funktionalen Änderungen ist dort ein neuer Eintrag mit Datum, kurzer Überschrift und Beschreibung zu ergänzen; sie gehört nicht als Runtime-Datei in `controls_fhem-cms.txt`.
- **Stories und Aufgaben als GitHub-Issues:** Status und Aufgaben stehen in den [Issues](https://github.com/stapetz/fhem-cms/issues); `dev-docs/STORIES.md` ist Archiv und Hintergrund (Zuordnung dort am Anfang). Neue Stories, Bugs und Ideen werden als Issue angelegt (`gh issue create`), Labels: `story`, `bug`, `enhancement`, `widget`, `navigation`, `layout`, `editor`, `security`, `safari`, `concept`, `draft`, `needs-test`, `later`. Commits und Pull Requests während der Entwicklung verweisen mit `Refs #<Nr>` auf das Issue. `Closes #<Nr>` wird nur für die Veröffentlichung nach `main` verwendet, damit ein Issue nicht vor dem Release automatisch geschlossen wird. `needs-test` bleibt bis zur erfolgreichen Prüfung auf dem Gerät. Issues sind öffentlich, keine Zugangsdaten oder Adressen eintragen.
- **Kanban-Ablauf:** Mit der Umsetzung eines auf `Ready` gesetzten Issues wird es auf `In Progress` verschoben. Sind der vereinbarte und abgrenzbare Lieferumfang implementiert, passende lokale Prüfungen erfolgreich und nötige Dokumentation fertig, wird es auf `In Review` gesetzt, damit der Entwickler die Geräte-/FHEM-Tests durchführen kann. `In Review` bedeutet „bereit zur Abnahme“, nicht „Abnahme abgeschlossen“: Eine noch ausstehende Geräteprüfung ist kein Grund, das Issue auf `In Progress` zu lassen. Falls nur ein ausdrücklich vereinbarter Teilumfang umgesetzt wird, dokumentiere den Prüfumfang und klar ausgeschlossene bzw. zurückgestellte Anforderungen im Issue; verschiebe den testbaren Teilumfang ebenfalls nach `In Review`, statt ihn wegen nicht enthaltener Folgearbeit in `In Progress` zu belassen. Anforderungen, die den vereinbarten Prüfumfang noch unklar machen, fehlende Freigaben oder fehlende Implementierung halten die Arbeit dagegen in `In Progress` bzw. `Backlog`. `needs-test` kennzeichnet die ausstehende Geräte-/FHEM-Prüfung. Ergibt die Abnahme einen reproduzierbaren Mangel oder ein nicht erfülltes vereinbartes Kriterium, wird das Issue mit dokumentiertem Befund zurück auf `In Progress` gesetzt; nach Behebung und erneuter lokaler Prüfung geht es wieder nach `In Review`. Nach bestätigter Abnahme wird `needs-test` entfernt und das offene Issue auf `Ready to publish` gesetzt. Diese Spalte ist die freigegebene Warteschlange für das nächste `main`-Release; sie bedeutet getestet und releasebereit, aber noch nicht veröffentlicht. Nicht vollständig getestete oder nicht für das Release freigegebene Arbeit bleibt ausserhalb dieser Spalte.
- **Release und Done:** Vor einem Release werden die Issues in `Ready to publish` als Releaseumfang verwendet. Erstelle zuerst eine nachvollziehbare Zuordnung Issue → Commit-Hashes und prüfe pro Issue, dass alle benötigten Commits referenziert, getestet und freigegeben sind. Erstelle dann einen Release-Branch vom aktuellen `main` und übernimm ausschliesslich diese Commits (z. B. per `cherry-pick`), nicht den gesamten `dev`-Branch. Prüfe den vollständigen Diff des Release-Branches gegen `main`: Jeder Code-/Dokumentationsdiff muss zu einem ausgewählten freigegebenen Issue oder zur nötigen Release-Metadatenänderung (Version, README, `CHANGED`) gehören. Sobald ein Commit zu einem Issue ausserhalb von `Ready to publish` enthalten ist, ein benötigter Commit fehlt oder ein Patch nicht unabhängig anwendbar ist, Release stoppen und die Änderung isolieren oder die betroffenen Issues gemeinsam freigeben lassen. Für jede Story im tatsächlichen Releaseumfang kommt eine Zeile `S<Nr> - <Issue-Titel>` in den `CHANGED`-Eintrag; zugehörige Fehlerbehebungen oder Nicht-Story-Issues werden in der Releasebeschreibung passend zusammengefasst. Nach erfolgreicher Veröffentlichung dieses Umfangs auf `main` werden nur die tatsächlich enthaltenen Issues geschlossen. Die Projektworkflows setzen geschlossene Issues auf `Done` und schliessen ein Issue ebenfalls, wenn es auf `Done` gesetzt wird; Wiederöffnen setzt es auf `Backlog`. Deshalb Issues nicht vor der Veröffentlichung schliessen oder manuell auf `Done` setzen. `Done` bedeutet ausschliesslich: getestet, auf `main` veröffentlicht und geschlossen. Falls ein für das Release vorgesehenes Issue nicht mit veröffentlicht wurde, bleibt es offen in `Ready to publish` oder wird bei zurückgestellter Arbeit nach Abstimmung zurück in `In Progress` gesetzt.
- Releases werden auf Story-Ebene beschrieben: Vor jedem Release in `dev-docs/STORIES.md` prüfen, ob Issue-Titel und Story-Zuordnung stimmen. Die Stories in `Ready to publish` liefern die `S<Nr> - <Titel der Story>`-Zeilen für den Releaseeintrag. Betrifft keine fertige Story das Release, entfällt die Zeile.
- **Versionsnummern und Release-Dateien:** Bei jedem freigegebenen `main`-Release automatisch eine neue stabile SemVer-Version `MAJOR.MINOR.PATCH` bestimmen, ausgehend von der zuletzt veröffentlichten Version (`FHEMCMS_VERSION` auf `main` bzw. dem letzten CMS-Release-Tag). Rückwärtsinkompatible Änderungen erhöhen `MAJOR`, neue rückwärtskompatible Funktionen `MINOR`, reine Fehlerkorrekturen und Dokumentationsänderungen `PATCH`; bei gemischtem Umfang gilt die höchste nötige Stufe. Die Release-Version ohne `-dev` in `FHEM/01_FHEMCMS.pm` setzen und die stabile Versionsangabe in `README.md` aktualisieren. Den Releaseeintrag in `CHANGED` mit Versionsnummer, Datum, Zusammenfassung und den Story-Zeilen aus dem tatsächlichen Release-Commitumfang ergänzen. `controls_fhem-cms.txt` nicht von Hand ändern: Der vorhandene GitHub-Actions-Workflow erzeugt und committet die Datei nach dem Push auf `main`. Vor dem Push prüfen, ob README, `CHANGED`, Modulversion und die ausgewählten Issue-Commits zusammenpassen; nach erfolgreichem Push nur die enthaltenen Issues schliessen und dadurch nach `Done` überführen. Die dev-Version behält den Suffix `-dev`.

## FHEM-Module

- Moduldateien liegen unter `FHEM/`; Anwenderdokumentation gehört unter `docs/`.
- Dateiname, registrierter FHEM-Gerätetyp und Perl-Paket müssen zusammenpassen.
- Für CMS-Releases gelten die Versions- und Veröffentlichungsregeln aus „Versionsnummern und Release-Dateien“.

## Projektanforderungen

# fhem-cms

> Eine moderne Smart-Home-Visualisierung und Content-Management-Plattform für FHEM.

**fhem-cms** ist eine erweiterbare Open-Source-Plattform zur Visualisierung und Steuerung von Smart-Home-Systemen auf Basis von FHEM. Das Projekt verschmilzt die strikte Architektur-Trennung moderner Web-Apps (Single-Page-Applications) mit der Flexibilität eines klassischen Content-Management-Systems (CMS).

---

## 1. Vision & Abgrenzung

* **Das Problem aktueller Lösungen:** Reine Steuerungs-UIs bieten oft zu wenig Raum für freien Text, Dokumentationen, Notizen oder statische Medien (Bilder/Videos). Klassische CMS wiederum besitzen keine native Echtzeit-Anbindung an Hausautomations-Backends.
* **Die Vision von fhem-cms:** Anwender können Dashboards erstellen, die *sowohl* reaktive Smart-Home-Widgets (Buttons, Charts) *als auch* redaktionelle Inhalte (freie Textblöcke, Kalendereinträge, eingebettete Medien, Anleitungen für Haushaltsmitglieder) nahtlos in einem attraktiven, responsiven Design vereinen.

---

## 2. Systemarchitektur (High-Level)

Das System ist als **Client-Server-Anwendung mit einer SPA im Browser** geplant. Die konkrete Transport- und Servertechnik ist noch zu validieren; Aussagen in der folgenden Übersicht sind Zielbild, keine vollständige Implementierungsspezifikation.

```text
+-------------------------------------------------------------------------+

|                          FRONTEND (Browser / SPA)                       |
|                                                                         |
|  +--------------------------- CMS Core ------------------------------+  |
|  |  - Layout Engine (Grid/Flex)     - State Management (Signals/Store)|  |
|  |  - Routing (Seitenverwaltung)     - Binding Engine (Echtzeit-Data)  |  |
|  +--------------------------------------------------------------------+  |
|                                     |                                   |
|  +-- CMS-Komponenten (Core) --+     +---- Smart-Home-Widgets (FHEM) ----+  |
|  |  - RichText / Markdown     |     |     - [fhem-button]               |  |
|  |  - ImageGallery            |     |     - [fhem-thermostat]           |  |
|  |  - Info-Cards              |     |     - [fhem-chart]                |  |
|  +----------------------------+     +-----------------------------------+  |
+-------------------------------------|-----------------------------------+
                                      | JSON API & Event-Transport (Technik offen)
                                      v
+-------------------------------------------------------------------------+

|                          BACKEND (FHEM / Perl)                          |
|                                                                         |
|  +-------------------------- 01_FHEMCMS.pm --------------------------+  |
|  |  - Device-Lifecycle und CMS-Konfiguration                           |  |
|  |  - Ereignis-/Zustandstransport (konkrete Technik offen)              |  |
|  |  - API für FHEM-Daten und CMS-Konfigurationen                        |  |
|  +--------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

Frontend-Dateien liegen unabhängig davon im FHEM-`www`-Kontext unter `www/fhem-cms/`
und werden über FHEMs normale statische Dateiauslieferung bereitgestellt.
Die Struktur orientiert sich funktional an FTUI3 (Komponenten, Module, Styles, Themes
und Icons), ergänzt um klassische Verzeichnisse für JavaScript und Bilder sowie eigene
einen Einstiegspunkt pro Device.

---

## 3. Funktionale Anforderungen (Features)

### 3.1. Backend-Ebene (FHEM / Perl)
* **Modul `01_FHEMCMS.pm`:** Ein natives FHEM-Perl-Modul, das via `define myCms FHEMCMS` instanziiert wird; der Gerätetyp wird ohne Beachtung der Groß-/Kleinschreibung erkannt.
* **Frontend im FHEM-`www`-Kontext:** Die statischen Frontend-Dateien liegen in einer eigenen Verzeichnisstruktur unter `www/fhem-cms/` und werden über FHEMs normale `www`-Auslieferung bereitgestellt. Das Steuerungsmodul stellt keinen eigenen Web-Endpunkt für die HTML-Seiten oder Assets bereit.
  * Die gemeinsame Ressourcenstruktur ist nach Funktionen gegliedert und an FTUI3 angelehnt. Vorgesehene Verzeichnisse sind `components/`, `examples/`, `icons/`, `images/`, `js/`, `modules/`, `css/` und `themes/`. Das FTUI3-Verzeichnis `styles/` wird im CMS zunächst als `css/` geführt; neue Verzeichnisse kommen nur bei konkretem Bedarf hinzu.
  * Für jedes CMS-Device wird genau ein Einstiegspunkt unter `www/fhem-cms/<device>/index.html` geführt. Der Device-Ordner verwendet den FHEM-Devicenamen direkt.
  * Die gerätespezifische HTML-Datei ist nur Bootstrap und lädt gemeinsame Ressourcen aus `www/fhem-cms/`. Die vollständige Inhaltsstruktur des CMS-Devices besteht aus einer Startseite mit Navigation zu weiteren Inhaltsseiten wie `urlaub.html`; Konfiguration und Inhalte bleiben in validiertem JSON und werden über die API geladen.
  * Neue CMS-Devices erhalten standardmäßig das FHEM-Room-Attribut `FHEM CMS`. Eine `FW_summaryFn` stellt in der FHEM-Raumansicht den direkten Link zur Startseite bereit und berücksichtigt den aktuellen FHEMWEB-Pfad.
  * Die `index.html` wird exklusiv angelegt. Eine vorhandene Datei wird nur als eigene Moduldatei akzeptiert, wenn sie den Modul-Marker enthält; fremde Dateien werden nicht überschrieben. Eine Datei mit Marker wird bei jedem Define/FHEM-Start neu geschrieben, sobald sich die Frontend-Dateien geändert haben (Cache-Busting, siehe unten). `undef` löscht die HTML-Datei vorerst nicht, damit keine Nutzerdaten oder fremden Dateien unbeabsichtigt entfernt werden.
* **Ereignis-/Zustandstransport (Technik offen):**
  * Liefert Zustandsänderungen über den ausgewählten Transport zeitnah an den Browser. Eine dauerhafte Vollduplex-Verbindung ist zu prüfen, nicht vorausgesetzt.
  * Filtert FHEM-Events (Readings) und pusht sie *nur dann* an den Client, wenn dieser das entsprechende Device abonniert hat (Ressourcenschonung).
* **Persistenz-API:** Bietet über die noch festzulegende API-Konvention Funktionen, um validierte JSON-Konfigurationen im FHEM-Dateisystem sicher zu speichern und zu laden.

### 3.2. Frontend-Ebene (Web-Kontext)
* **Reaktives Daten-Binding:** Implementierung einer deklarativen Syntax im HTML (z. B. via Custom Elements / Web Components), um FHEM-Zustände ohne manuelles JavaScript an das UI zu binden.
* **CMS-Kernfunktionen:**
  * **Seiten- & Menüverwaltung:** Dynamisches Routing im Frontend (z. B. Wechsel zwischen "Wohnzimmer", "Energieübersicht", "Haus-Handbuch").
  * **Inhalts-Komponenten:** Native Elemente für freien Text (Markdown-Unterstützung), Bild-Uploads/Anzeige, Wetter-Widgets und RSS-Feeds.
* **Community-Erweiterbarkeit (Plugin-System):** Eine klar definierte Schnittstelle (Base Widget Class), die es Drittentwicklern erlaubt, eigene Widgets per JS/CSS hinzuzufügen, ohne den Kern von `fhem-cms` anzufassen zu müssen.

---

## 4. Nicht-funktionale Anforderungen

* **Attraktive Bedienung & Design (UX/UI):** Moderne, cleane Ästhetik. Unterstützung von Dark/Light-Mode ab Werk. Große, touch-freundliche Bedienflächen, optimiert für Wandtablets.
* **Performance:** Sofortiges Laden (SPA). Flüssige Animationen (60 FPS) bei Zustandsänderungen. Minimale CPU-Last auf dem FHEM-Server (wichtig für Setups auf älteren Raspberry Pis).
* **Robustheit:** Automatische Wiederverbindung nach Netzwerkabriss mit dem gewählten Ereignistransport. Die Anwendung lädt danach aktuelle Zustände erneut, ohne UI-Freeze.

---

## 5. Technische Spezifikation (Tech Stack)

Um das Projekt zukunftssicher und für die Community hochgradig attraktiv zu gestalten, wird folgender Stack definiert:

* **Backend:** Perl (FHEM API) und JSON-Kommunikation; der konkrete Transport ist noch offen.
* **Frontend-Basis:** Reine **Standard Web Components** (Custom Elements, Shadow DOM, HTML Templates). *Vorteil:* Keine Abhängigkeit von schweren Frameworks wie Angular oder React. Höchste native Browser-Performance und langfristige Wartbarkeit.
* **CSS / Layout:** CSS Grid und Flexbox für ein vollständig responsives Design (Mobile-First-Ansatz). Verwendung von CSS Custom Properties (Variables) für einfaches Theme-Management.
* **Konfigurationsformat:** Speicherung von Seitenstrukturen und Layouts als **JSON**. Das macht die Verwaltung im Hintergrund flexibler als pures HTML.

### Unterstützte FHEM-Version

Zum Stand **31.10.2026** ist **FHEM 6.5** die aktuelle stabile Veröffentlichung (veröffentlicht am 24.10.2026). fhem-cms setzt mindestens FHEM 6.5 voraus. Die Kompatibilität ist gegen die aktuelle stabile FHEM-Version zu prüfen; konkrete Tests gegen Entwicklungs-/Nightly-Stände sind optional und separat zu dokumentieren.

Quelle: [Offizielle FHEM-Seite und Downloadbereich](https://fhem.de/) (abgerufen am 31.10.2026).

---

## 6. Daten-Binding & Syntax-Design (Beispiel)

Für die Verknüpfung von FHEM und dem CMS-Frontend wird ein deklaratives Prinzip angestrebt. Das folgende Beispiel ist ein früher Entwurf, keine verbindliche Schnittstelle. Die Schreibweise mit `[state]` und `(click)` ist Angular-ähnlich und keine native Web-Components-Syntax.

### Beispiel für ein Smart-Home-Widget:
```html
<!-- Inbound: Button spiegelt den Zustand des FHEM-Lichts wider -->
<!-- Outbound: Klick triggert den FHEM-Befehl "set WohnzimmerLicht toggle" -->
<fhem-button
    [state]="WohnzimmerLicht:state"
    (click)="set WohnzimmerLicht toggle"
    icon="lightbulb">
    Wohnzimmer Licht
</fhem-button>
```

### Beispiel für eine CMS-Komponente (Redaktioneller Inhalt):
```html
<!-- Freier Textblock für Haushaltsregeln oder Notizen -->
<cms-text-block title="Müllabfuhr Hinweis">
    Bitte denkt daran, **dienstags** die grüne Tonne an die Straße zu stellen!
</cms-text-block>
```

---

## 7. Roadmap & Nächste Schritte (MVP)

1. **Phase 1: Das Fundament (Backend & Core)**
   * Validierung des FHEM-Integrations- und Kommunikationswegs sowie Aufbau eines passenden Backend- und Frontend-Grundgerüsts.
   * Aufbau der Frontend-Ordnerstruktur und Implementierung des Basis-Verbindungs-Skripts (`cms-core.js`).
2. **Phase 2: Die CMS-Basis**
   * Entwicklung der Layout-Engine (Grid-System) und eines ersten Text- sowie Bild-Moduls.
   * Speichern und Laden eines Layouts als JSON-Datei über das FHEM-Modul.
3. **Phase 3: Die FHEM-Widgets (Smart Home)**
   * Entwicklung der ersten Kern-Widgets: `fhem-label` (Zustände anzeigen) und `fhem-button` (Schalten).
4. **Phase 4: Community-Opening**
   * Veröffentlichung der Widget-API-Dokumentation, damit andere Entwickler eigene Module beisteuern können.

## Konkretisierung und Status der Anforderungen

Dieser Abschnitt konkretisiert den bisherigen Stand und frühere Anforderungen. Für
das neue Zielbild hat der FCUI-Styleguide Vorrang; Statusangaben beschreiben den
Bestand und ändern sich erst mit der Umsetzung. Offene Entscheidungen werden in
Issues bearbeitet und nach Beschluss hier festgehalten.

### Architektur und Verantwortlichkeiten

- **Frontend:** rendert Seiten, Layouts und Widgets. Es ist nicht vertrauenswürdig und ersetzt keine Validierung oder Berechtigungsprüfung im Backend.
- **FHEM-Modul:** ist die Vertrauensgrenze für den Zugriff auf FHEM-Daten, das Speichern von Konfigurationen, das Erzeugen der gerätebezogenen HTML-Startdatei beim `define` und später gegebenenfalls das Ausführen von Steuerbefehlen. Es liefert die CMS-Seiten und Frontend-Assets nicht über einen eigenen Webserver aus.
- **Frontend-Dateien:** liegen im FHEM-`www`-Kontext unter `www/fhem-cms/`, getrennt vom Web-Endpunkt des Steuerungsmoduls. Die gemeinsame, FTUI3-inspirierte Struktur enthält `components/`, `examples/`, `icons/`, `images/`, `js/`, `modules/`, `css/` und `themes/`. Der Einstieg je Gerät liegt unter `www/fhem-cms/<device>/index.html`.
- **Beispielstruktur:**

  ```text
  www/fhem-cms/
  ├── components/
  ├── examples/
  ├── icons/
  ├── images/
  ├── js/
  ├── modules/
  ├── css/
  ├── themes/
  └── <fhem-device-name>/
      └── index.html
  ```

  Die gemeinsamen Ressourcen werden nicht pro Device dupliziert. Das Device-Verzeichnis verwendet exakt den FHEM-Devicenamen und enthält einen Bootstrap-Einstiegspunkt `index.html`. Unterschiedliche CMS-Inhalte werden innerhalb des Devices als Seiten modelliert und über die Navigation verknüpft; ein weiteres CMS-Device erhält einen eigenen Ordner und Einstiegspunkt. `get <device> url` gibt die URL zu dieser `index.html` zurück. Das Löschen der Device-Definition entfernt keine Dateien; Datenbereinigung darf nur über eine separate, ausdrücklich ausgelöste Funktion erfolgen.
- **Datenzugriff:** der Browser erhält nur Daten, für die die jeweilige FHEM-Sitzung berechtigt ist. Abonnements sollen auf benötigte Geräte/Readings begrenzt und bei Seitenwechsel oder Verbindungsende aufgeräumt werden.
- **Noch offen:** die abschliessende Wahl des Ereignistransports, die JSON-API, Berechtigungsprüfung, sichere Slug-/Kollisionsstrategie und der Lebenszyklus der gerätebezogenen HTML-Einstiegsdatei sowie der CMS-Inhaltsseiten. Die Mindestversion ist FHEM 6.5; Tests gegen diese Baseline bleiben Teil der Integrationsprüfung.
- Ein eigener WebSocket-Server und ein zusätzlicher REST-Endpunkt sind nicht als verbindliche Architektur beschlossen. Vor einer Entscheidung ist ein Machbarkeitsnachweis zu erstellen und hinsichtlich Abhängigkeiten, Berechtigungen und Serverlast zu bewerten.
- Backend und Frontend kommunizieren mit JSON. Die bereits gesetzten Leitplanken sind Perl/FHEM, Standard Web Components, CSS Grid/Flexbox, CSS Custom Properties und JSON-Konfigurationen.

#### Vorläufige FHEMWEB-Transportprüfung (S02)

Die aktuelle FHEMWEB-Implementierung kennt für `longpoll` die Werte `0`, `1` und `websocket`. Der Browser der FHEM-Oberfläche nutzt für Statusmeldungen den FHEMWEB-`inform`-Pfad; bei `longpoll=websocket` wird derselbe Inform-Datenstrom über WebSocket übertragen. Die eingehenden Statusnachrichten sind zeilenweise JSON. FHEMWEB kann den Stream alternativ als HTTP-Langpoll bereitstellen. Für den WebSocket-Pfad prüft FHEMWEB das optionale Perl-Modul `Digest::SHA`.

Ohne numerischen `since`-Wert verwendet FHEMWEB standardmässig `time()-5` und liefert initial nur Statuswerte mit einem neueren Änderungszeitpunkt. Ein Client kann mit `since=0` ältere Statuswerte anfordern; ob das für alle benötigten Readings und den Reconnect des CMS genügt, muss der Machbarkeitstest zeigen.

**Arbeitskandidat, noch keine Architekturentscheidung:** FHEMWEB-`inform` als Ereigniskanal, WebSocket bevorzugt und HTTP-Langpoll als Fallback; ein eigener Ereignisserver wäre dafür zunächst nicht erforderlich. Snapshot und CMS-Konfiguration benötigen einen separat zu prüfenden JSON-Zugriff. Authentifizierung, CSRF, Geräte-/Reading-Berechtigungen und das Verhalten auf FHEM 6.5 sind vor Freigabe mit einem Machbarkeitsnachweis zu validieren (S02/S03). Bis dahin werden keine produktive API und kein eigener Ereignisserver implementiert.

Ein temporärer Read-only-Prototyp hat in der FHEM-Instanz des Entwicklers eine WebSocket-Verbindung aus FHEMWEB sowie die Statusänderungen `on` und `off` eines Dummy-Devices bestätigt. Die Testseite wurde nach dem Versuch aus dem Repository entfernt und wird nicht als Produktdatei ausgeliefert. Temporäre Dummy-Devices sind nach einem Test wieder zu löschen. Die genaue FHEM-Version, ein vollständiger Initial-Snapshot und die Abgrenzung von Geräte-/Reading-Berechtigungen sind noch zu prüfen. Das erfolgreiche Öffnen aus einer angemeldeten Oberfläche allein belegt noch keine Autorisierungstests.

Für weitere UI- und Funktionstests darf der integrierte Browser auf eine vom Entwickler ausdrücklich benannte Testinstanz zugreifen, sofern diese aus der Browserumgebung erreichbar ist. Tests sind standardmässig lesend; Änderungen an FHEM-Geräten oder CMS-Inhalten brauchen eine ausdrückliche Freigabe. Die konkreten Zugriffsregeln stehen in [copilot-instructions.md](../.github/copilot-instructions.md).

Quellen zur Vorprüfung: [FHEMWEB-Modul](https://github.com/fhem/fhem-mirror/blob/main/fhem/FHEM/01_FHEMWEB.pm) und [FHEM-Webfrontend](https://github.com/fhem/fhem-mirror/blob/main/fhem/www/pgm2/fhemweb.js). Die Prüfung des aktuellen Quellstands ersetzt keinen Laufzeittest gegen die unterstützte FHEM-6.5-Baseline.

### Binding, Widgets und Konfigurationsdaten

Gespeicherte Seiten und Layouts sind JSON-Daten und kein ausführbares HTML. Die beim `define` erzeugte HTML-Datei ist nur der gerätebezogene Einstiegspunkt (Bootstrap); sie enthält weder die CMS-Seitenkonfiguration noch ausführbare, aus Benutzerdaten generierte Inhalte. Das Frontend lädt die validierte JSON-Konfiguration über die API. Das folgende Format ist ein Beispiel zur Diskussion; Schema-Version, Feldnamen und Widget-Vertrag müssen noch festgelegt werden:

```json
{
  "schemaVersion": 1,
  "pages": [
    {
      "id": "wohnzimmer",
      "title": "Wohnzimmer",
      "widgets": [
        {
          "id": "licht-status",
          "type": "fhem-value",
          "device": "WohnzimmerLicht",
          "reading": "state"
        }
      ]
    }
  ]
}
```

- Die erste Binding-Schnittstelle soll mindestens ein lesendes Widget, Initialwerte, Live-Änderungen sowie Lade-, Fehler-, Offline- und Berechtigungszustände beschreiben.
- Das Frontend darf keine beliebigen Code-Ausdrücke aus einer Konfiguration ausführen.
- Lesende Bindings und schreibende Aktionen sind getrennte Funktionen. Buttons oder andere Steuerungen werden erst nach Definition und Prüfung des Sicherheitsmodells umgesetzt.
- Die Persistenz prüft Konfigurationen gegen ein versioniertes Schema. Schema-Migrationen, unbekannte Felder und Speicherlimits müssen definiert werden.
- Daten werden nur in einem festgelegten CMS-Verzeichnis gespeichert. IDs und Dateinamen werden validiert; Pfad-Traversal ist zu verhindern. Schreibvorgänge sollen vor Teil- oder Überschreibungsfehlern schützen.
- Markdown und Nutzereingaben werden bei der Darstellung gegen XSS abgesichert. Ungeprüftes Roh-HTML gehört nicht in das Konfigurationsformat; das `html`-Feld des Textbausteins ist ein streng validierter Allowlist-Teilsatz (siehe „WYSIWYG-Editor und Medien“).

### Sicherheit

- **Identität und Transport:** Es gibt keine separate CMS-Anmeldung. Jede API muss dieselbe FHEM-Websitzung und deren Rechte nutzen; anonyme Zugriffe werden abgewiesen. Browserzugriffe bleiben gleich-originig zu FHEMWEB. Es werden weder CORS-Freigaben für fremde Origins noch Zugangsdaten im CMS gespeichert.
- **Schreibschutz und CSRF:** Der MVP bietet keine schreibenden FHEM-Steuerbefehle. Konfigurationsänderungen sind davon getrennte Schreibvorgänge und müssen FHEMWEB-Authentifizierung und dessen CSRF-Schutz einhalten. Vor der Implementierung ist zu prüfen, wie die gewählte FHEM-Version CSRF-Token für den konkreten Request bereitstellt und validiert.
- **Geräte und Readings:** Der Client darf keine FHEM-Kommandos, Devspec-/Regex-Filter oder Dateipfade übermitteln. Backend-Aufrufe akzeptieren nur explizite, syntaktisch validierte Device- und Reading-Namen; das Backend prüft Existenz und Lesbarkeit bei jeder Anfrage gegen den autorisierten FHEM-Kontext. Abonnements bleiben auf die konfigurierte Auswahl begrenzt und werden beim Verbindungsende entfernt.
- **FHEMWEB-Inform:** Inform-Nachrichten gelten als nicht vertrauenswürdige Daten. Es wird nur der benötigte Statuswert ausgewertet und als Text dargestellt; von FHEMWEB geliefertes HTML/SVG wird nicht ausgeführt oder in das DOM eingefügt. `since=0` und Filter dürfen keinen ungeprüften, globalen Gerätezugriff erzeugen.
- **Persistenz und Eingaben:** Konfigurationen werden gegen ein versioniertes Schema geprüft und ausschliesslich in einem festgelegten Datenverzeichnis ausserhalb der öffentlich statischen `www`-Auslieferung gespeichert. Typ-, Schema-, Grössen- und Pfadprüfungen erfolgen serverseitig. Unbekannte Felder und nicht unterstützte Schema-Versionen werden abgewiesen statt stillschweigend entfernt oder überschrieben.
- **Fehler und Protokolle:** Ungültige oder nicht autorisierte Anfragen erhalten erkennbare Fehler. Logs enthalten weder Sitzungs-/CSRF-Token noch Konfigurationsinhalte oder andere Secrets; Eingaben werden vor einer Protokollierung begrenzt und bereinigt.
- **Noch zu verifizieren:** FHEM-Version und konkrete Authentifizierungs-/CSRF-Konfiguration der Referenzinstanz, Verhalten bei fehlender Sitzung, eingeschränkten Berechtigungen und unzulässigen Devices/Readings sowie die Einbindung des CMS-Datenverzeichnisses in FHEM-Backup und Restore.
- Externe Medien, RSS-Quellen und Plugins bilden zusätzliche Vertrauensgrenzen und bleiben außerhalb des MVP, bis deren Sicherheitsregeln festgelegt sind.

### Nicht-funktionale Anforderungen und Messbarkeit

- **Referenzumgebung:** FHEM 6.5 auf dem vorhandenen FHEM-System. Phone- und Tablet-Referenzmodelle werden vor der MVP-Abnahme in S10 festgehalten; sie blockieren nicht die Architekturprüfung.
- **Browsermatrix:** jeweils aktuelle und vorherige stabile Hauptversion, bestimmt zum Zeitpunkt des Tests. Zu prüfen sind Edge, Chrome und Firefox auf Windows, macOS, Linux, Android und iOS sowie Safari auf macOS und iOS, soweit die jeweilige Browser-App auf der Plattform verfügbar ist.
- **Mobile First:** Layout und Interaktionen werden zuerst für kleine Smartphone-Bildschirme entworfen und anschliessend für Tablets und Desktop erweitert. Phone-, Tablet- und Desktop-Ansichten sind Teil der Abnahme. Auf Phone-Breite darf kein horizontales Seiten-Scrolling erforderlich sein; Kernaktionen müssen mit Touch und Tastatur erreichbar sein und sichtbaren Tastaturfokus bieten. Touch-Ziele sollen mindestens 44 × 44 CSS-Pixel gross sein.
- **Bedienung:** responsive Darstellung für Wandtablet, Phone, Tablet und Desktop. Kernabläufe müssen auf den festgelegten Browser-/Betriebssystemkombinationen geprüft werden.
- **Robustheit:** bei Verbindungsabbruch zeigt die UI einen erkennbaren Offline-/Wiederverbindungsstatus. Nach Wiederverbindung werden aktuelle Zustände erneut geladen und erforderliche Abonnements wiederhergestellt; veraltete Nachrichten dürfen keinen neueren Zustand überschreiben.
- **Performance-Abnahme:** Für ein Dashboard mit 20 Widgets gelten im lokalen Netz die bestätigten Ziele: erste bedienbare Ansicht innerhalb von 2 Sekunden und Anzeige einer Reading-Änderung innerhalb von 500 ms. Die erste Zeit wird ab Navigation bis zur bedienbaren CMS-Ansicht gemessen; die zweite ab der ausgelösten FHEM-Änderung bis zur sichtbaren Aktualisierung im Widget. S10 protokolliert die Messungen auf dem FHEM-Referenzsystem und den dort getesteten Browser-/Gerätekombinationen.
- **Serverlast:** Ereignisse sollen nur an interessierte Clients gehen. CPU- und Speicherverbrauch werden auf der festgelegten FHEM-Referenzhardware mit dokumentierter Anzahl von Geräten, Widgets und Ereignissen gemessen. Grenzwerte werden vor dem MVP-Abnahmetest festgelegt.
- „60 FPS“ ist kein pauschales Abnahmekriterium für alle Zielgeräte. Animationen dürfen die Bedienung nicht blockieren; die Leistung wird auf der vereinbarten Referenzhardware geprüft.

### Bestätigter MVP-Umfang und Abnahmekriterien

Der MVP-Umfang und die Nicht-Ziele wurden am 31.10.2026 bestätigt. Er umfasst:

1. Statische CMS-Dateien liegen unter `www/fhem-cms/` und werden von FHEMs normaler `www`-Auslieferung bereitgestellt; das Steuerungsmodul bedient keine HTML- oder Asset-Seiten selbst.
2. Beim Anlegen eines CMS-Devices wird genau eine HTML-Bootstrap-Datei unter `www/fhem-cms/<device>/index.html` erzeugt. Sie lädt die gemeinsamen Assets und startet dieses Device. Inhaltsseiten wie `urlaub.html` gehören zur Inhaltsstruktur des Devices und werden von der Startseite aus navigiert.
3. Die HTML-Datei lädt und speichert eine validierte JSON-Konfiguration, die nach einem FHEM-Neustart erhalten bleibt.
4. Eine SPA mit mindestens einer Seite, Navigation und responsivem Layout.
5. Einen einfachen Text-/Markdown-Baustein.
6. Ein lesendes FHEM-Widget, das ein Reading initial und bei Änderungen darstellt.
7. Begrenzte Datenabonnements sowie erkennbare Lade-, Offline-, Fehler- und Berechtigungszustände.
8. Geprüfte Sicherheits-, Performance- und Serverlastkriterien auf der vereinbarten Testumgebung.

**Vorgeschlagene Nicht-Ziele des MVP:** schreibende FHEM-Steuerung, Bild-Uploads, Kalender, Wetter, RSS, externe Medien und Community-Plugins. Diese Funktionen können nach dem MVP als eigene Stories aufgenommen werden.

Die konkreten Phone-/Tablet-Modelle werden vor der Abnahme in S10 ergänzt. Eine Roadmap-Phase gilt erst als abgeschlossen, wenn ihre Akzeptanzkriterien erfüllt sind, passende Tests vorliegen und die Entwicklerdokumentation aktualisiert ist.

### Langfristige Reihenfolge

1. MVP, Referenzsystem und messbare Abnahmekriterien festlegen.
2. FHEM-Integrationsweg, Kommunikation und Sicherheitsmodell durch Entscheidungen und Machbarkeitsnachweise klären.
3. JSON-Schema, Persistenz und Widget-/Binding-Vertrag definieren.
4. Backend-Grundlage und SPA implementieren.
5. Textkomponente und lesende FHEM-Widgets umsetzen und den MVP abnehmen.
6. Schreibende Widgets und weitere Integrationen nur nach separater Sicherheits- und Umfangsentscheidung ergänzen.
7. Ein Plugin-System erst spezifizieren, wenn die interne Widget-Schnittstelle stabil ist.

Die konkreten, abhängigen Stories und ihre Akzeptanzkriterien stehen in der [Story- und Aufgabenliste](./STORIES.md). Offene Architekturentscheidungen gelten nicht als erledigt, bevor Entscheidung und Begründung hier dokumentiert sind.

### Lokaler Test mit einem FHEM-Device

Für den ersten manuellen Test FHEM 6.5 oder neuer verwenden:

1. Entwicklungsquelle einmalig registrieren: `update add https://raw.githubusercontent.com/stapetz/fhem-cms/dev/controls_fhem-cms.txt`.
2. Repository-Dateien gemeinsam aktualisieren: `update all https://raw.githubusercontent.com/stapetz/fhem-cms/dev/controls_fhem-cms.txt`.
3. FHEM neu starten.
4. `define cmsTest FHEMCMS` ausführen und mit `get cmsTest url` den URL-Pfad abrufen.

Das Testfrontend bestätigt die Anlage und zeigt den Device-Namen. Eine JSON-API, Persistenz und Live-FHEM-Datenanbindung sind in diesem ersten Gerüst noch nicht enthalten.

## Konfigurationsspeicher (S04)

- Pfad: `<modpath>/fhem-cms-data/<Device>/config.json`, ausserhalb von `www`. Der Ordner wird beim `define` und bei jedem FHEM-Start nachgerüstet, falls er fehlt; eine vorhandene Konfiguration wird nie überschrieben.
- Format: `{"schemaVersion":4,"theme":"dark|light","navigation":{"orientation":"horizontal|vertical","grid":{…}},"pages":[{"id","title","widgets":[{"type":"fhem-value","device","reading","grid":{"col","row","w","h"}}]}]}`. Unbekannte Felder, fehlende Pflichtfelder und nicht unterstützte Versionen werden abgewiesen. `theme` ist die globale Farbpalette des Devices (Standard `dark`); `navigation` bleibt optional (S18).
- Limits: 1 MiB, höchstens 50 Seiten, 200 Widgets je Seite, Raster 48 Spalten. Schema-Version 2 wird beim Lesen migriert: `col` wird als `(col - 1) * 4 + 1`, `w` als `w * 4` umgesetzt; `row` und `h` bleiben unverändert. Damit behalten bestehende Layouts ihre Position und Grösse.
- Schema-Version 3 wird auf Version 4 migriert und erhält standardmässig das dunkle Theme. Die Ansichts- und Bearbeitungsmodi verwenden dieselbe deviceweite Auswahl `dark` oder `light`; CSS Custom Properties werden auch von Web Components im Shadow DOM geerbt. Freie Farben und weitere Themes sind nicht Teil dieser Ausbaustufe.
- Schreiben: temporäre Datei, dann atomares `rename`; die Vorgängerversion bleibt als `config.json.<JJJJMMTT-hhmmss>.bak` erhalten (die letzten 20).
- Wiederherstellen: `FHEMCMS_RestoreBackup` akzeptiert nur Backup-Namen dieses Musters und validiert die Datei vor dem Zurückschreiben. Ein UI-Dialog folgt später.
- `delete <Device>` löscht den Datenordner nicht; die bestätigte Löschfunktion ist offen.
- Entwurf (S13): `draft.json` im selben Ordner, gleiches Schema und gleiche Validierung. `FHEMCMS_WriteConfig($name,$dir,$config,$target)` schreibt wahlweise `config.json` (mit Backup und Rotation) oder `draft.json` (ohne Backup). `set publish` liest und validiert den Entwurf, schreibt ihn live (Backup des alten Stands) und löscht ihn. `restore` wirkt nur auf `config.json`. `FHEMCMS_ListBackups` erfasst nur `config.json.*.bak`. `purge` entfernt den ganzen Ordner inklusive Entwurf. Das Frontend liest im Bearbeitungsmodus den Entwurf (`get draft`), im Ansichtsmodus den Live-Stand. Es gibt keine Sperre gegen paralleles Bearbeiten (S14).

## Erstes Widget: Thermostat-Kachel (Test)

- Widgets werden deklarativ in `config.json` beschrieben und von der Seite in Web Components übersetzt (`type: "thermostat"` → `<cms-thermostat>`). Es gibt keine ausführbaren Ausdrücke; freie Markup-Erweiterungen sind eine spätere Entscheidung.
- Schema Version 2: Widgets haben eine `id`. Version-1-Konfigurationen werden beim Lesen automatisch migriert. Thermostat-Felder: `device`, optional `title`, `readings` (`actual`, `target` Pflicht; `valve`, `mode`, `battery` optional) und `grid`.
- Lesen: Die Seite liest Gerätedaten über FHEMWEB (`jsonlist2`) und lädt bei WebSocket-Inform-Ereignissen nach. Fällt der WebSocket aus, aktualisiert sie alle 30 s.
- Schreiben: Der Sollwert wird mit `set <Device> <target-Reading> <Wert>` über FHEMWEB (POST mit CSRF-Token) gesendet. Anmeldung, Rechte und `allowed` verantwortet FHEMWEB. Der Regler läuft von 5 bis 25 °C in 0,5-Schritten, nach 1,5 s Ruhe wird gesendet.
- Konfiguration: `get <CMS> config|backups` und `set <CMS> config <Base64-JSON>|restore <Backup>` des Moduls. Der Dialog der Kachel wählt das Device über ein Popup mit Name, Alias, Typ, Raum und „Kanal von“ aus der Geräteliste (`TYPE=MAX` und `TYPE=CUL_HM`). Die Suche läuft über alle Spalten, zusätzlich hat jede Spalte ein eigenes Filterfeld. Wird ein Kanal gewählt, übernimmt der Dialog sein Hauptdevice (Internal `device`). Gespeichert wird immer das Hauptdevice.

  Readings werden über das Hauptdevice und seine Kanäle gesucht (z. B. `th_kueche`, `th_kueche_Weather`, `th_kueche_Climate`). Die Kachel lädt dafür `jsonlist2 <device>,device=<device>`, abonniert auch die Kanäle per WebSocket und nimmt je Reading-Name den ersten Treffer (zuerst Hauptdevice, dann Kanäle alphabetisch). Der Dialog zeigt bei Readings aus einem Kanal dessen Namen an. Den Set-Befehl für den Sollwert erhält das Device, aus dem das Soll-Reading stammt. Die Konfiguration bleibt unverändert (`readings` enthält nur Reading-Namen).
- Noch offen: Verhalten bei fehlenden Rechten, FHEM-6.5-Kompatibilität, mehrere Seiten, eigene Widget-Pakete mit Konfigurationsschema.

### Cache-Busting der Startseite

FHEMWEB und vorgeschaltete Proxys (z. B. nginx) halten statische Dateien lange im Cache. Deshalb enthält die erzeugte `index.html` ein Token (10 Hex-Zeichen, MD5 über Pfade und Inhalt aller `css/*.css`, `js/*.js` und `components/*.js`). Es hängt als `?v=<Token>` am Stylesheet und am Einstiegsskript. Eine Import-Map bildet alle weiteren Module auf versionierte URLs ab, sodass auch Komponenten nach einem Update neu geladen werden. Nach `update` und `shutdown restart` schreibt `FHEMCMS_Define` die Startseite bei geändertem Token atomar neu. Ohne Neustart genügt `set <CMS> rebuild`; außerdem prüft das Anzeigen des Startlinks in FHEMWEB (`FHEMCMS_Summary`, höchstens alle 10 s) das Token und erneuert die Seite bei Bedarf. Die `index.html` selbst muss vom Cache revalidiert werden. Hinter einem Proxy mit langer Cache-Dauer kann sie daher noch einmal hart neu geladen werden müssen.

## Seiten, Navigation und Textbaustein (S07/S08)

- **Seiten:** `pages[]` der Konfiguration wird als Navigation (Links `#/<seiten-id>`) angezeigt. Der Hash bestimmt die aktuelle Seite, unbekannte Hashes führen zur ersten Seite. Seiten anlegen, umbenennen, löschen und umsortieren erledigt der Dialog des Navigations-Widgets (S18) über die validierte API; die letzte Seite kann nicht gelöscht werden. Die Reihenfolge von `pages[]` ist die Menüreihenfolge. Eingabe des Titels über einen eigenen `<dialog>` (kein `prompt()`).
- **Navigations-Dialog (S18):** arbeitet auf `structuredClone(this.config)`; Umsortieren per Pointer-Events am ☰-Griff (Listener am `document`, da DOM-Verschieben das Pointer-Capture beendet); `Speichern` ruft `arrangeAround()` und `persist()`, `Abbrechen` verwirft.
- **Navigations-Widget (S18):** `navigation` (`orientation`, `grid`) steht global in der Konfiguration. Im Frontend ist es als Pseudo-Widget `__nav` Teil der Layout-Logik (`layoutItems()`); Verschieben und Größe laufen wie bei Kacheln. `arrangeAround()` schiebt beim Speichern überlappende Kacheln der übrigen Seiten nach unten. Fehlt `navigation` (ältere Konfiguration), setzt `loadConfig()` im Speicher eine Standardnavigation (horizontal, Zeile 1, volle Breite) und rückt alle Kacheln um eine Zeile nach unten; gespeichert wird beim nächsten Schreiben.
- **Schlanke Seite (S17):** Die erzeugte `index.html` enthält nur `<main class="cms-shell">` mit einer Statuszeile (`.cms-status`). Die Komponente `cms-device-card` entfiel. Im Ansichtsmodus ist die Statuszeile nur bei einem Fehler sichtbar.
- **Live-Abos:** Daten und WebSocket-Abos gelten nur für die aktuelle Seite und werden beim Seitenwechsel neu aufgebaut.
- **Menü „Einfügen“:** Thermostat-Kachel, Wert-Anzeige, Uhr/Datum, Status-Symbol, Tabelle, Schieberegler, Schalter, Taster, Freies HTML und Textbaustein.
- **Taster (`type: "fhem-button"`, S33):** Felder `id`, `type`, `device`, `command` (ein Set-Befehl ohne Parameter, `[A-Za-z0-9_.-]+`), `grid`, optional `title`, `label` (1–32 Zeichen ohne Steuerzeichen; leer = Befehl), `icon`. Server validiert alle Felder, es gibt keine freien Befehle oder Werte. `cms-button` sendet beim Klick `set <Device> <command>` über `services.setCommand`; Rückmeldung: Knopf kurz hell nach Erfolg, Fehlermeldung in der Kachel. Doppelklicks während des Sendens werden ignoriert. Geschaltet wird nur in der Ansicht. Er hat keine Live-Daten.
- **Schieberegler (`type: "fhem-slider"`, S34):** Felder `id`, `type`, `device`, `command`, `reading`, `grid`, optional `title`. Nur Set-Beschreibungen der Form `command:slider,min,step,max` werden angeboten; Grenzen und Schrittweite werden nicht aus Nutzereingaben übernommen. Der aktuelle Wert kommt aus dem gewählten Reading. Die Ansicht sendet den Wert nach 1,5 Sekunden Ruhe über den FHEMWEB-Set-Befehl; veraltete oder nicht numerische Werte sperren den Regler.
- **Schalter (`type: "fhem-switch"`, S32):** Felder `id`, `type`, `device`, `reading` (Zustand, Standard `state`), `on`, `off` (Set-Befehle ohne Parameter, Namen `[A-Za-z0-9_.-]+`, voneinander verschieden), `grid`, optional `title`, `icon` (bei „an“), `iconOff`. Der Server validiert alle Felder; es werden nie freie Befehle gespeichert. `cms-switch` sendet beim Klick `set <Device> <on|off>` über `services.setCommand(device, command)` (Wert optional, `FhemClient.setCommand` prüft Namen). Zustand: Reading gleich `on` bzw. `off`, sonst unbekannt (gestrichelter Rand); nach dem Klick gilt 4 s der erwartete Zustand, bei Fehlern erscheint die Meldung in der Kachel. Geschaltet wird nur in der Ansicht (`view-only`), nie im Bearbeitungsmodus. Die Befehlsauswahl im Dialog stammt aus `PossibleSets` (nur Befehle ohne Argument). Gemeinsame Dialoge: `js/device-picker.js` (Device suchen) und `js/icon-picker.js` (Icon wählen) für alle neuen Widgets.
- **Freies HTML (`type: "fhem-html"`, S31):** Felder `id`, `type`, `html` (höchstens 20000 Zeichen), `devices` (Liste, höchstens 20 eindeutige Device-Namen; der Editor leitet sie aus den Platzhaltern ab), `grid`, optional `title`. Strenge Allowlist für Elemente und Attribute, serverseitig in `FHEMCMS_ValidateFreeHtml`, clientseitig in `js/freehtml.js` (bereinigt beim Rendern in einen neuen DOM). Zusätzlich zu `{{Device:reading|filter}}` ersetzt ein Element mit den Attributen `device`, `reading` und optional `filter` seinen Inhalt durch den Wert (FTUI-Stil; Server und Client prüfen Namen und Filter mit festen Regexen, `device` und `reading` nur zusammen). Werte werden nur als Text eingesetzt; Platzhalter-Syntax in `docs/PLATZHALTER.md`. Die Kachel erhält `data` als `Map` Device → [Hauptdevice, Kanäle …]. Schaltaktionen sind (noch) nicht vorgesehen.

Die Shell verwendet die gespeicherte `devices`-Liste auch für den Snapshot-Abruf
und das Abonnement, einschließlich gefundener Kanäle. Der Regressionstest
`t/08_html_bindings.test.js` prüft Abruf, Aktualisierung und Fehlerzustand mit
synthetischen Daten; eine Prüfung auf einer FHEM-Testinstanz steht noch aus.
- **Wert-Anzeige (`type: "fhem-value"`, S25):** Felder `id`, `type`, `device`, `reading`, `grid`, optional `unit` (1–16 Zeichen ohne Steuerzeichen) und `icon` (logischer FHEMWEB-Icon-Name wie `temp_temperature` oder `weather/sunny`, ohne `..`, höchstens 80 Zeichen). Komponente `components/cms-value.js`; Wert aus `snapshots` des Devices (Hauptdevice, dann Kanäle), Aktualisierung wie die Thermostat-Kachel (`isLiveWidget`). Device-Auswahl wie bei der Thermostat-Kachel (Suchdialog, siehe „Konfigurationsdialog für Widgets“). Die Auswahllisten nutzen `jsonlist2 .*` (`listAllDevices`, einmal je Seite zwischengespeichert) und `get <CMS> icons`: `FHEMCMS_ListIcons` liest `www/images/<Stil>/` (Tiefe ≤ 4, keine Symlinks, höchstens 5000 Namen, ohne Endung). Das Icon lädt der Browser über FHEMWEB unter `<FHEMWEB>/icons/<Name>`. Angezeigt wird Text (`textContent`), kein HTML.
- **Uhr/Datum (`type: "fhem-clock"`, S38):** speichert nur `style` (`digital`, `date` oder `analog`) sowie die booleschen Optionen `showSeconds`, `showDate` und `showWeekday`; keine FHEM-Devices oder Netzwerkzugriffe. Zeit und Datum stammen lokal aus dem Browser. Das Layout wird im Dialog über Vorschaukarten gewählt.
- **Status-Symbol (`type: "fhem-icon"`, S36):** Felder `id`, `type`, `device`, `reading`, `states` (1–20 eindeutige Reading-Werte mit logischem Icon-Namen und Hex-Farbe), `grid`, optional `title`. Readings kommen aus dem Live-Snapshot; es gibt keine Schreibaktion. Nicht zugeordnete Werte werden als Text ausgegeben.
- **Tabelle (`type: "fhem-table"`, S41):** Felder `id`, `type`, `rows` (1–40 eindeutige Device/Reading-Paare, optional `unit`), `grid`, optional `title` und `deviceLabel` (Überschrift der Geräte-/Bezeichnungsspalte). Die Reading-Spalte bleibt intern und wird nicht angezeigt. Übliche Einheiten sind auswählbar, eigene Einheiten sind auf 16 Zeichen ohne Steuerzeichen begrenzt. `devicesOf()` abonniert die verwendeten Devices; die Komponente erhält eine Map der Snapshots und rendert Werte und Einheiten ausschließlich als Text.
- **Textbaustein (`type: "text"`):** Felder `id`, `type`, genau eines von `html` (WYSIWYG, siehe unten) oder `markdown` (Altbestand; höchstens 20000 Zeichen, keine Steuerzeichen außer Tab/Zeilenumbruch), optional `title` (höchstens 64 Zeichen), `grid`. Der Renderer `js/markdown.js` ist eigenständig und baut nur DOM-Knoten per `createElement`/`textContent`. Unterstützt: `#`–`###`, Absätze, `-`/`1.`-Listen, `**fett**`, `*kursiv*`, `` `code` ``, `[Text](URL)`. HTML bleibt Text; Links nur mit `http(s)` oder relativ (`/`, `./`, `../`, `#`), mit `rel="noopener noreferrer"`.

## Konfigurationsdialog für Widgets (verbindlich für alle Widgets)

Jedes Widget mit Device-Bezug folgt dem Muster der Thermostat-Kachel:

1. Das Feld „FHEM-Device“ ist schreibgeschützt. „Auswählen …“ (oder Klick ins Feld) öffnet einen Suchdialog: ein Suchfeld über alle Spalten, Filter je Spalte (Device, Alias, Typ, Raum, Kanal von), höchstens 200 angezeigte Treffer, Auswahl per Klick oder Enter.
2. Nach der Auswahl wird das Device im Konfigurationsdialog des Widgets eingetragen; abhängige Felder (z. B. Readings) werden aus den Daten dieses Devices befüllt.
3. Der Dialog hat immer Speichern, Abbrechen und – bei bestehenden Widgets – Löschen. Ein neues, abgebrochenes Widget wird entfernt (`cms-widget-cancel`).
4. Geräte kommen über `services.listDevices()` (typbegrenzt) bzw. `services.listAllDevices()` (alle Geräte), Icons über `services.listIcons()`; keine eigenen FHEM-Aufrufe in der Komponente.

5. Keine nativen Browser-Popups in Dialogen: `<datalist>` (und ähnliche Auswahlfenster) werden vom Browser außerhalb des modalen `<dialog>`/Shadow-DOM positioniert und springen aus dem Fenster. Vorschläge werden stattdessen im Dialog selbst gezeigt (z. B. Schaltflächen unter dem Textfeld, die den Wert eintragen; freier Text bleibt möglich). Für Listen sind `<select>` oder der Suchdialog zu verwenden.

6. Größe: Kacheln müssen bis 1×1 Rasterfeld verkleinerbar sein. Rasterzeilen haben nur 2,75 rem Mindesthöhe; Widgets mit festem Inhalt skalieren Schrift und Icons über Container-Einheiten (`container-type: size`, `cqh`/`cqw`) statt feste Mindestmaße zu setzen.
7. Icons: FHEM-Icons sind meist schwarz und auf dem dunklen Design unlesbar. Sie werden deshalb nicht als `<img>`, sondern als CSS-Maske (`mask-image: var(--icon-url)`) mit `background-color: var(--cms-icon-color)` (Standard `#8fd0a8`) gezeichnet; die Farbe kommt aus dem CSS. Nachteil: mehrfarbige Icons werden einfarbig. Der FHEMWEB-Farbsuffix (`@farbe`) wird nicht verwendet.

8. Icon-Liste: `get <CMS> icons` listet alle Stile unter `www/images/`; eine Filterung nach `iconPath` hat die Liste leer gemacht und ist daher nicht vorgesehen. Namen, die FHEMWEB nicht ausliefert (Fehler 404), entfernt der Icon-Picker nach dem Laden selbst wieder, damit keine leeren Kacheln bleiben.
9. Container-Einheiten (`cqh`/`cqw`) im Shadow-DOM: Der Container (`container-type: size`) muss ein Element innerhalb des Shadow-DOMs sein (z. B. die Kachel), nicht der Host.
10. Optionaler Titel: Jedes Widget hat im Dialog das Feld „Titel (optional)“ (`title`, höchstens 64 Zeichen, keine Steuerzeichen; im Schema als optionales Feld, in `FHEMCMS_ValidateConfig` für alle Widget-Typen geprüft). Ohne Titel verwendet das Widget einen sinnvollen Ersatz (Alias, Device-Name). Neue Widgets müssen `title` im Schema erlauben und in der Kachel (ausblendbar bei kleiner Größe) anzeigen.
11. Alias anzeigen: Unter dem Feld „FHEM-Device“ steht, falls vorhanden und vom Namen verschieden, „Alias: …“ (Element `data-device-alias`, gefüllt beim Öffnen des Dialogs und nach der Auswahl aus der Geräteliste). Im Widget wird weiterhin der technische Name gespeichert. Auch der Suchdialog zeigt Name und Alias.
12. Schriftgrößen: Inhalte in Kacheln sind klein und fließend skalierend (`clamp(min, <n>cqh/cqw, max)` mit kleinen Obergrenzen, z. B. Wert höchstens 1,5 rem, Icon höchstens 1,5 rem, Thermostat-Zahlen höchstens 1,9 rem). Die Thermostat-Kachel folgt der Darstellung des ThermostatDashboard (Titelzeile, Box Ist/Soll, Zeile mit Modus, Ventil, Batterie); Neue Thermostat-ähnliche Widgets übernehmen sie. Raster: Abstand (`--cms-gap`) und Zeilenhöhe (`--cms-row-h`) sind ab 40 rem in `cqw` der Seitenbreite angegeben (`.cms-shell` ist Container); neue Layout-Logik darf keine festen px/rem für Rasterzellen annehmen, sondern muss die Variablen verwenden. Widgets mit mehreren Bereichen passen ihr Layout der Kachelform an (Container-Query auf `aspect-ratio`) und skalieren die Schrift so, dass der Inhalt die Kachel in beiden Richtungen ausnutzt; den Platzbedarf in `em` vorher ausmessen. Der Inhalt von Widgets mit mehreren Bereichen (Thermostat) ist oben ausgerichtet; einfache Anzeigen mit einem einzigen Wert (Wert-Anzeige) stehen mittig in der Kachel, das Titel-Label bleibt in beiden Fällen oben links und kompakt gesetzt; bleibt Platz übrig, bleibt er unten frei. Titel aller Widgets: kleines Label (gedämpftes Grün) oben links, ohne Kopfzeile und Trennlinie; Zahnrad klein absolut oben rechts, nur im Bearbeitungsmodus (`view-only` blendet es aus). Rahmen: dünn, Radius ca. 1,4 rem (FTUI-Stil: klein, kompakt, einfach). Schriftgrößen werden ohne feste Ober- und Untergrenzen (höchstens ein kleiner Mindestwert wie `max(4px, …)`) aus `cqh`/`cqw` berechnet, damit das Skalieren nahtlos ist. Kacheln mit mehreren Bereichen skalieren den gesamten Inhalt über eine Basisschrift (`font-size` aus `cqh`/`cqw`, Inhalt in `em`) und verteilen Restplatz mit `justify-content: space-evenly`; Bereiche werden nicht auf die Kachelhöhe gestreckt (sonst entstehen Leerflächen), und Texte dürfen nicht abgeschnitten werden.
13. Verschieben und Größe ändern: Jedes Widget lässt sich im Bearbeitungsmodus gleich verschieben (Griff oben, Pfeiltasten) und in der Größe ändern (Griff unten rechts). Das leistet allein die App-Shell über `syncOverlays()` und das Raster `grid`; ein Widget implementiert dafür nichts selbst, darf aber den oberen Streifen (1,6 rem) und die untere rechte Ecke nicht mit eigenen, höher liegenden Elementen belegen. Die Overlays werden nach jeder Änderung der Widget-Liste neu aufgebaut: nach dem ersten Speichern eines neuen Widgets (`saveWidget`), nach dem Löschen (`deleteWidget`) und in `renderWidgets`. Wer einen neuen Widget-Typ ergänzt, prüft im Test: hinzufügen, speichern, sofort verschieben und in der Größe ändern, ohne die Seite neu zu laden.
14. Kachel-Symbole und Tooltips: Oben rechts stehen nebeneinander ⇄ (Widget auf andere Seite verschieben), ⠿ (Widget auf dieser Seite verschieben) und ⚙ (Bearbeiten). ⇄ und ⠿ liefert die App-Shell. Das ⚙ liegt in der Komponente: Button mit `data-open-config`, `title="Widget konfigurieren"` und einem typspezifischen `aria-label` (z. B. „Tabelle konfigurieren“), oben rechts (`top: 0.2rem; right: 0.3rem`), damit die Shell-Symbole links daneben Platz haben.

Neue Widgets übernehmen diesen Ablauf; Abweichungen werden vorher in `STORIES.md` abgestimmt.

## Live-Zustände und Verbindungsverhalten (S09)

- **Abrufe:** Ein Refresh ist genau ein `jsonlist2`-Aufruf je Seite (Hauptdevices plus Kanäle über `device=<name>`), unabhängig von der Widget-Zahl. Das Polling läuft alle 30 s, nur bei sichtbarem Tab. Beim Sichtbarwerden und bei `online` wird sofort neu gelesen.
- **Live-Hinweise:** Eine WebSocket-Verbindung (`inform`) je geöffneter Seite, gefiltert auf die Namen der aktuellen Seite. Ereignisse lösen ein entprelltes (300 ms) Neulesen aus, die Werte kommen nie aus dem Ereignis-HTML. Der WebSocket wird bei Seitenwechsel neu aufgebaut und bei `pagehide` beendet; Reconnect mit Backoff (1 s bis 30 s).
- **Reconnect:** Nach dem Wiederverbinden wird sofort der aktuelle Zustand neu gelesen. Aus dem Back-Forward-Cache zurückkehrende Seiten starten Polling und Refresh neu (`pageshow`).
- **Fehler und veraltete Zustände:** Schlägt ein Abruf fehl, bleiben die letzten Werte sichtbar, die Kachel wird gedämpft und gestrichelt dargestellt, trägt „Veraltet seit hh:mm:ss“ und der Sollwert-Slider ist gesperrt. Die Statuszeile nennt die Ursache. Beim nächsten erfolgreichen Abruf verschwindet die Markierung.
- **Autorisierung:** Das CMS besitzt keine eigene Rechteprüfung für Readings. FHEMWEB (`allowed`, Device-Rechte) entscheidet; ohne Berechtigung schlagen die Abrufe fehl und werden als Fehler angezeigt.
- **Nicht gemessen:** Serverlast und Latenz auf der Referenzumgebung (Messung gehört zu S10).

## Daten eines Devices löschen (purge)

`delete <CMS>` entfernt nur die FHEM-Definition; Datenordner und Startseite bleiben bewusst erhalten, damit ein versehentliches Löschen keine Konfiguration vernichtet. Zum endgültigen Entfernen:

```
set <CMS> purge <CMS>
delete <CMS>
```

`Datei → Daten löschen …` zeigt vor der Aktion die beiden betroffenen Device-Ordner und bietet `Daten endgültig löschen`, `Behalten` und `Abbrechen`. Vor dem Löschen wartet das Frontend ausstehende Layout- und Entwurfsschreibvorgänge ab. `purge` löscht `<modpath>/fhem-cms-data/<Device>/` (inklusive Backups) und `<modpath>/www/fhem-cms/<Device>/`. Es verweigert die Aktion bei Symlinks, bei Dateien im Startseitenordner, die nicht vom Modul stammen, und bei einer Startseite ohne Modul-Marker. Die gemeinsamen Assets unter `www/fhem-cms/` bleiben unangetastet. Danach sind `get`, `set` und der Startlink gesperrt (Status `purged`), bis das Device gelöscht oder FHEM neu gestartet wird; ein Neustart oder erneutes `define` legt leere Standarddaten wieder an.

## Backups wiederherstellen (Frontend)

Die Schaltfläche „Backups“ in der Werkzeugleiste öffnet einen Dialog mit allen Sicherungen (neueste zuerst, Anzeige als Datum und Uhrzeit). Ein Klick fragt nach und führt dann `set <CMS> restore <Name>` aus. Vor der Wiederherstellung sichert das Modul den aktuellen Stand als eigenes Backup, sodass der Schritt umkehrbar ist. Restore ändert nur den Live-Stand; ein vorhandener Entwurf bleibt unverändert und wird nicht automatisch aus dem wiederhergestellten Stand neu erzeugt. Der Client zeigt danach einen entsprechenden Statushinweis und behält den Entwurf zur weiteren Bearbeitung. Ohne offenen Entwurf wird die wiederhergestellte Konfiguration neu geladen und die aktuelle Seite angezeigt (oder die erste, falls sie im Backup nicht existiert). Der Client akzeptiert nur Namen im Format `config.json.<JJJJMMTT-HHMMSS>[-n].bak`.

## Ansichts- und Bearbeitungsmodus (`?mode=edit`)

Die Device-Zeile in FHEMWEB zeigt „CMS starten“ (`index.html?mode=edit`) und „Zeige Homepage“ (`index.html` ohne Parameter), beide mit `target="_blank" rel="noopener"`. Ohne Parameter gilt der Ansichtsmodus; nur `mode=edit` aktiviert die Bearbeitung, damit die öffentliche Adresse keinen Modus-Parameter nennt. `js/fhem-cms.js` liest den Parameter beim Start, setzt im Ansichtsmodus die Klasse `cms-view` am `html`-Element und das Attribut `view-only` an den Kacheln. Das CSS blendet Kopf, Werkzeugleiste und Device-Karte aus (Fehlermeldungen bleiben sichtbar), die Kacheln blenden ihr Zahnrad aus. Es ist eine reine Darstellung ohne Sicherheitswirkung: Schreibzugriffe laufen weiter über FHEMWEB und `allowed`.

Vorschau: Der Button „Vorschau“ öffnet `index.html?mode=preview` in einem neuen Fenster. Der Modus verhält sich wie der Ansichtsmodus, liest aber den Entwurf (`get draft`) statt des Live-Stands und blendet den Entwurfshinweis aus.

Entwurfsänderungen werden im Frontend der Reihe nach gespeichert. Vor `publish` und `discard` müssen sowohl ausstehende Layoutänderungen als auch alle laufenden Entwurfsspeicherungen abgeschlossen sein; ein fehlgeschlagener Speichervorgang verhindert die Aktion und wird angezeigt. So kann eine schnelle Veröffentlichung nicht vor dem Speichern der Theme-Änderung den vorherigen Stand übernehmen.

## WYSIWYG-Editor und Medien

**Farben (S21):** Der Editor setzt Farben per `foreColor`/`hiliteColor` (mit `styleWithCSS`). Der Cleaner wandelt sie in `<span style="color:#rrggbb;background-color:#rrggbb">` um (auch `font`, `mark` und Stile an anderen Tags). Das Modul akzeptiert `style` nur an `span` und nur genau in dieser Form; Namen, Kurzformen, weitere Eigenschaften und `url()` werden abgewiesen.

**Navigationseinträge (S20):** `navigation.items` ist optional: `[{"page","label","width","height"}]` (`label` 1–64 Zeichen, `width` 40–600, `height` 24–200, je Seite höchstens ein Eintrag, `page` muss existieren). `sizeNav()` setzt für Einträge ohne eigene Maße die Größe des größten Eintrags.

Platzhalter im Textbaustein (S45): Der Text enthält `{{Device:reading|filter}}` als normalen Text; `FHEMCMS_ValidateHtml` lässt ihn zu, weil die Zeichen im Textbereich erlaubt sind. Zusätzlich lehnt der Server mehr als 20 verschiedene Devices je Text ab. Die Shell leitet die Devices zur Laufzeit aus dem Text ab (`devicesOf` in `fhem-cms.js`, `extractDevices` aus `js/freehtml.js`), abonniert sie wie beim freien HTML und gibt `cms-text` per `data` eine Map Device → [Hauptdevice, Kanäle]. `cms-text` ersetzt die Platzhalter nach der Bereinigung in den Textknoten (`substituteIn`, nur Text, nie HTML). Im Editor sind Platzhalter unteilbare Bausteine (`.cms-ph`, `contenteditable=false`); `chipify` wandelt beim Öffnen, `serializeArea` beim Speichern um. `document.execCommand` überspringt `contenteditable=false`-Bausteine; deshalb zieht `formatChips` in `richtext.js` Fett, Kursiv, Unterstrichen, Durchgestrichen, Textfarbe, Hervorhebung und `removeFormat` auf Platzhalter in der Auswahl nach (Flags `data-b/i/u/s/color/bg`), und `serializeArea` schreibt sie als `<b>`, `<i>`, `<u>`, `<s>`, `<span style>` um den `{{…}}`-Text. `insertNode` legt einen Platzhalter nie direkt in die Editor-Fläche, sondern in einen Absatz (sonst Zeilenumbruch). Der gemeinsame Suchdialog liegt in `js/placeholder-picker.js` und wird auch vom freien HTML benutzt; jedes neue Widget mit Texteingaben nutzt ihn ebenfalls, statt eigene Device-Suchen zu bauen.

Der Textbaustein nutzt einen eigenen, schlanken Editor auf `contenteditable` (`js/richtext.js`, keine Fremdbibliothek). Funktionen: fett, kursiv, unterstrichen, durchgestrichen, Überschriften 1–3, Absatz, Zitat, Listen, Ausrichtung, Links, Tabellen (Zeilen/Spalten einfügen und löschen), Bilder, Rückgängig/Wiederholen. Alte Markdown-Bausteine werden beim Öffnen des Editors nach HTML überführt und beim Speichern als `html` abgelegt.

**Sicherheitsmodell (zwei unabhängige Prüfungen mit gleicher Allowlist):**

- Frontend: `cleanHtml`/`renderHtml` parsen mit `DOMParser` (inert) und bauen ein neues DOM nur aus erlaubten Elementen. Die Funktion wird für Einfügen, Speichern und Anzeige benutzt; es gibt kein `innerHTML` auf Live-Daten.
- Modul: `FHEMCMS_ValidateHtml` lehnt alles Unerlaubte ab, statt es umzuschreiben. Erlaubt sind `p`, `h1`–`h3`, `blockquote`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `strong`, `em`, `u`, `s`, `code`, `br`, `hr`, `a` (nur `href`: `http(s)://`, `mailto:` oder `#/<seite>`) und `img` (nur `media/<32 Hex>.png|jpg|gif`). Klassen nur aus `cms-align-*`, `cms-img-*` und `cms-w-1` bis `cms-w-100` (1-%-Schritte). Keine Event-, Style- oder sonstigen Attribute. Grenzen: 50000 Zeichen, 3000 Elemente, Tiefe 30.
- Links werden mit `target="_blank"` und `rel="noopener noreferrer"` gerendert.

**Bildgröße:** Ein Ziehpunkt (`.rt-handle`, außerhalb der editierbaren Fläche und deshalb nie Teil des gespeicherten HTML) sitzt an der unteren rechten Ecke des gewählten Bildes. Zeigerbewegung oder Pfeiltasten setzen die Klasse `cms-w-<1..100>` (Anteil an der Textbreite, Höhe folgt über `height:auto`); die feinste Auflösung beträgt einen Prozentpunkt. Ältere Klassen `cms-w-25|50|75|100` bleiben gültig.

**Bilder:** Upload per `set <CMS> media <base64>` (nur PNG, JPEG, GIF, höchstens 3 MiB, Prüfung der Magic-Bytes, kein SVG/WebP). Ablage unter `www/fhem-cms/<Device>/media/<md5>.<ext>` (Deduplizierung per MD5, atomares Schreiben, höchstens 200 Dateien). Der Rückgabewert ist der relative Pfad. `get <CMS> media` listet die Dateien. FHEMWEB liefert nur `png`, `jpg` und `gif` mit Bild-MIME-Typ aus, deshalb sind andere Formate ausgeschlossen. Bilder werden noch nicht automatisch gelöscht (Folge-Story); `purge` entfernt den Medienordner.

## Kacheln verschieben (Bearbeitungsmodus)

Im Bearbeitungsmodus (`layoutMode = !VIEW_MODE`, kein Umschalter mehr) liegt über jeder Kachel eine durchklickbare Ebene `.cms-drag-layer` mit dem Zuggriff `.cms-drag-handle` (Kachelkopf, rechts 3 rem für das ⚙ frei; bei der Navigation am unteren Rand) und dem Größengriff. Die Werkzeugleiste (`.cms-toolbar`, `role=toolbar`) ist eine schwebende (`position: fixed`, nicht im Raster enthaltene) Menüleiste aus vier `details`-Dropdowns (`makeMenu`: Datei, Bearbeiten, Einfügen, Ansicht; `closeMenus()` hält immer nur eines offen und schließt bei Klick außerhalb). Gitternetz (S23): `syncGuides()` legt als erstes Kind des Rasters `.cms-guides` (Subgrid, `pointer-events: none`) mit einer leeren Zelle je Rasterfeld an; Zustand in `localStorage` (`fhem-cms-show-grid`). Meldungen: `setStatus`/`updateIndicator` schreiben Status und Entwurfshinweis in die Box `.cms-status-box` (im `body`, Klick auf die `.cms-status`-Zeile schaltet sie um); die Zeile erscheint im Bearbeitungsmodus per CSS als rotes „!“ oben rechts. Die Werkzeugleiste sitzt oben links in Blau. Der Griff wird für jede Kachel angelegt. Die Kachel lässt sich per Maus oder Touch ziehen oder mit dem fokussierten Griff per Pfeiltasten um eine Zelle verschieben. Die Zelle unter dem Zeiger wird aus der tatsächlichen Spurbreite und den berechneten Zeilenhöhen des CSS-Rasters ermittelt (`js/layout.js`). Überlappende Kacheln rutschen nach unten (`moveWidget`), das Ergebnis wird beim Loslassen (bei Pfeiltasten nach 700 ms Ruhe oder beim Verlassen des Griffs) über die normale Konfigurationsspeicherung geschrieben. Schlägt das Speichern fehl, springt das Layout auf den gespeicherten Stand zurück. Die Größe ändert ein Griff unten rechts (`attachResize`, `resizeWidget` in `js/layout.js`; ziehen per Zeiger oder Umschalt+Pfeiltasten am Kachel-Griff). `w` wird auf die freien Spalten rechts von `col` begrenzt, `h` auf höchstens 1000; überlappende Kacheln rutschen wie beim Verschieben nach unten. Die Konfigurationsdialoge enthalten keine Rasterfelder mehr: `collectWidget` übernimmt `grid` unverändert, neue Kacheln erhalten Spalte 1, die erste freie Zeile und eine Standardgröße (`addWidget`). Auf schmalen Bildschirmen (einspaltig) sind die Griffe ausgeblendet.
