# Entwicklungsdokumentation

Diese Dokumentation richtet sich an Entwickler und KI-Agenten. Sie ist nicht für die Auslieferung an FHEM-Anwender bestimmt. Sie ist der zentrale Informationsraum für Projektziel, Anforderungen, technische Entscheidungen und Entwicklungswissen. Anforderungen dürfen und sollen hier im Entwicklungsverlauf ergänzt und angepasst werden.

Die bekannten, nach Abhängigkeiten geordneten Umsetzungsstories stehen in der [Story- und Aufgabenliste](./STORIES.md). Diese Dokumentation beschreibt das Zielbild und die Anforderungen; die Storyliste verfolgt deren schrittweise Umsetzung.

## Repositorystruktur

| Pfad | Zweck |
|---|---|
| `FHEM/` | FHEM-Modul und Integration |
| `docs/` | Anwenderdokumentation |
| `dev-docs/` | Interne Entwicklungsdokumentation |
| `.github/` | GitHub-Konfiguration und Copilot-Anweisungen |
| `controls_fhem-cms.txt` | Vom Workflow erzeugte FHEM-Update-Liste des gesamten installierbaren Repositories |
| `scripts/generate_controls.py` | Erzeugt `controls_fhem-cms.txt` aus `FHEM/` und `www/fhem-cms/` |

## Branches und Freigaben

- `dev` ist der Arbeits- und Testbranch. Änderungen werden zuerst hier entwickelt und geprüft.
- `main` enthält freigegebene Stände und ist der Veröffentlichungsbranch.
- Vor einer Veröffentlichung nach `main` ist eine ausdrückliche Freigabe des Entwicklers erforderlich. Ein Auftrag für Änderungen oder Pushes nach `dev` ist keine Freigabe für `main`.
- Nach einer freigegebenen Veröffentlichung werden die Branches wieder synchronisiert, damit die Weiterentwicklung auf `dev` auf dem freigegebenen Stand aufsetzt.
- Die Repository-Standardeinstellung bleibt `main`, damit veröffentlichte Inhalte für Nutzer der stabile Bezugspunkt sind.

## Änderungen, Tests und Pushes

- Vor jedem Push die aktuelle Branch-Version mit `git pull --rebase --autostash` aktualisieren. Bei einem neuen Branch ohne Remote-Tracking-Branch zuerst den passenden Remote-Branch festlegen bzw. abrufen.
- Für KI-unterstützte Commits den Trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` ergänzen.
- Zu Änderungen passende Tests und Syntaxprüfungen ausführen. Für Perl-Module ist mindestens `perl -c` auszuführen; gegebenenfalls benötigte FHEM-Core-Funktionen müssen in Tests geeignet bereitgestellt werden.
- `controls_fhem-cms.txt` wird vom Workflow aus allen installierbaren Dateien unter `FHEM/` und `www/fhem-cms/` erzeugt. Der repositorybezogene Name verhindert Kollisionen mit den lokal auf dem FHEM-Server abgelegten Controls-Dateien anderer Update-Quellen. Es gibt eine gemeinsame Update-Quelle für das ganze Repository, keine Controls-Dateien je Modul oder Komponente. Die Datei nicht von Hand ändern.

## FHEM-Module

- Moduldateien liegen unter `FHEM/`; Anwenderdokumentation gehört unter `docs/`.
- Dateiname, registrierter FHEM-Gerätetyp und Perl-Paket müssen zusammenpassen.
- Versions- und Veröffentlichungsregeln für das Modul werden dokumentiert, sobald die konkrete Modul- und Update-Strategie feststeht.

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
Einstiegspunkte pro Device und Oberfläche.

---

## 3. Funktionale Anforderungen (Features)

### 3.1. Backend-Ebene (FHEM / Perl)
* **Modul `01_FHEMCMS.pm`:** Ein natives FHEM-Perl-Modul, das via `define myCms FHEMCMS` instanziiert wird.
* **Frontend im FHEM-`www`-Kontext:** Die statischen Frontend-Dateien liegen in einer eigenen Verzeichnisstruktur unter `www/fhem-cms/` und werden über FHEMs normale `www`-Auslieferung bereitgestellt. Das Steuerungsmodul stellt keinen eigenen Web-Endpunkt für die HTML-Seiten oder Assets bereit.
  * Die gemeinsame Ressourcenstruktur ist nach Funktionen gegliedert und an FTUI3 angelehnt. Vorgesehene Verzeichnisse sind `components/`, `examples/`, `icons/`, `images/`, `js/`, `modules/`, `css/` und `themes/`. Das FTUI3-Verzeichnis `styles/` wird im CMS zunächst als `css/` geführt; neue Verzeichnisse kommen nur bei konkretem Bedarf hinzu.
  * Für jedes CMS-Device und jede zugehörige Oberfläche wird ein eigener Einstiegspunkt unter `www/fhem-cms/<device>/<oberflaeche>/index.html` geführt. Beim `define` wird der Einstiegspunkt für die initiale Oberfläche erzeugt; weitere Oberflächen erhalten jeweils ein eigenes Unterverzeichnis.
  * Die geräte- und oberflächenspezifische HTML-Datei ist nur Bootstrap und lädt gemeinsame Ressourcen aus `www/fhem-cms/`. Konfiguration und Inhalte bleiben in validiertem JSON und werden über die API geladen.
  * Device-Verzeichnisse werden kollisionsfrei als `d-` plus kleingeschriebene Hex-Kodierung des UTF-8-Device-Namens abgebildet. So bleiben Namen mit Groß-/Kleinschreibung auch auf case-insensitiven Dateisystemen unterscheidbar. Die initiale Oberfläche heißt `default`.
  * Die `index.html` wird exklusiv angelegt. Eine vorhandene Datei wird nur als eigene Moduldatei akzeptiert, wenn sie den Modul-Marker enthält; fremde Dateien werden nicht überschrieben. `undef` löscht die HTML-Datei vorerst nicht, damit keine Nutzerdaten oder fremden Dateien unbeabsichtigt entfernt werden.
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

Dieser Abschnitt konkretisiert das vorangehende Zielbild. Bei Widersprüchen haben die nachfolgenden Statusangaben Vorrang: breit formulierte Visionen und frühere Beispiele sind keine bereits beschlossenen Implementierungsdetails. Offene Entscheidungen werden zuerst in der Storyliste bearbeitet und nach Beschluss hier festgehalten.

### Architektur und Verantwortlichkeiten

- **Frontend:** rendert Seiten, Layouts und Widgets. Es ist nicht vertrauenswürdig und ersetzt keine Validierung oder Berechtigungsprüfung im Backend.
- **FHEM-Modul:** ist die Vertrauensgrenze für den Zugriff auf FHEM-Daten, das Speichern von Konfigurationen, das Erzeugen der gerätebezogenen HTML-Startdatei beim `define` und später gegebenenfalls das Ausführen von Steuerbefehlen. Es liefert die CMS-Seiten und Frontend-Assets nicht über einen eigenen Webserver aus.
- **Frontend-Dateien:** liegen im FHEM-`www`-Kontext unter `www/fhem-cms/`, getrennt vom Web-Endpunkt des Steuerungsmoduls. Die gemeinsame, FTUI3-inspirierte Struktur enthält `components/`, `examples/`, `icons/`, `images/`, `js/`, `modules/`, `css/` und `themes/`. Der Einstieg je Gerät und Oberfläche liegt unter `www/fhem-cms/<device>/<oberflaeche>/index.html`.
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
  └── d-<hex-device-name>/
      ├── default/
      │   └── index.html
      └── <oberflaeche-2>/
          └── index.html
  ```

  Die gemeinsamen Ressourcen werden nicht pro Device dupliziert. Die Device- und Oberflächenverzeichnisse enthalten die jeweiligen HTML-Bootstrap-Einstiegspunkte; Konfiguration und Inhalte bleiben in der JSON-Persistenz. `get <device> url` gibt die URL zur initialen `default`-Oberfläche zurück.
- **Datenzugriff:** der Browser erhält nur Daten, für die die jeweilige FHEM-Sitzung berechtigt ist. Abonnements sollen auf benötigte Geräte/Readings begrenzt und bei Seitenwechsel oder Verbindungsende aufgeräumt werden.
- **Noch offen:** WebSocket gegenüber vorhandenen FHEM-Schnittstellen oder einer Alternative, Aufteilung zwischen JSON-API und Ereigniskanal, sichere Slug-/Kollisionsstrategie und Lebenszyklus der geräte- und oberflächenbezogenen HTML-Dateien. Die Mindestversion ist FHEM 6.5; Tests gegen diese Baseline bleiben Teil der Integrationsprüfung.
- Ein eigener WebSocket-Server und ein zusätzlicher REST-Endpunkt sind nicht als verbindliche Architektur beschlossen. Vor einer Entscheidung ist ein Machbarkeitsnachweis zu erstellen und hinsichtlich Abhängigkeiten, Berechtigungen und Serverlast zu bewerten.
- Backend und Frontend kommunizieren mit JSON. Die bereits gesetzten Leitplanken sind Perl/FHEM, Standard Web Components, CSS Grid/Flexbox, CSS Custom Properties und JSON-Konfigurationen.

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
- Markdown und Nutzereingaben werden bei der Darstellung gegen XSS abgesichert. Ungeprüftes Roh-HTML gehört nicht in das Konfigurationsformat.

### Sicherheit

- API-Zugriffe müssen an die FHEM-Sitzung und deren Berechtigungen gebunden sein. Die konkrete Nutzung von FHEM-Authentifizierung, CSRF-Schutz und Berechtigungen ist vor Umsetzung zu verifizieren.
- Geräte, Readings und Befehle werden serverseitig validiert. Der Browser darf keine beliebigen FHEM-Kommandos ausführen können.
- Dauerhafte Verbindungen müssen Sitzung und zulässigen Ursprung prüfen und Verbindungen/Abonnements bei Sitzungsende schließen.
- Eingaben, Konfigurationen und gegebenenfalls spätere Uploads benötigen Typ-, Größen- und Pfadprüfungen. Secrets und sensible Werte dürfen weder im Quellcode noch in Logs erscheinen.
- Externe Medien, RSS-Quellen und Plugins bilden zusätzliche Vertrauensgrenzen und bleiben außerhalb des MVP, bis deren Sicherheitsregeln festgelegt sind.

### Nicht-funktionale Anforderungen und Messbarkeit

- **Mobile First:** Layout und Interaktionen werden zuerst für kleine Smartphone-Bildschirme entworfen und anschließend für Tablets und Desktop erweitert. Die Oberfläche muss sowohl Phone- als auch Tablet-Ansichten unterstützen; Touch-Ziele und Navigation sind für mobile Nutzung auszulegen.
- **Betriebssysteme:** Windows, macOS und Linux auf Desktop-/Laptop-Systemen sowie Android und iOS auf Phone und Tablet.
- **Browser:** aktuelle unterstützte Versionen von Edge, Chrome, Firefox und Safari. Safari ist insbesondere für macOS und iOS Teil der Browsermatrix; die konkrete Mindestversion je Browser und Betriebssystem ist in S01 festzulegen.
- **Bedienung:** responsive Darstellung für Wandtablet, Phone, Tablet und Desktop; große Touch-Ziele. Tastaturbedienbarkeit und sichtbarer Fokus sind für alle Kernaktionen erforderlich. Kernabläufe müssen auf den festgelegten Browser-/Betriebssystemkombinationen geprüft werden.
- **Robustheit:** bei Verbindungsabbruch zeigt die UI einen erkennbaren Offline-/Wiederverbindungsstatus. Nach Wiederverbindung werden aktuelle Zustände erneut geladen und erforderliche Abonnements wiederhergestellt; veraltete Nachrichten dürfen keinen neueren Zustand überschreiben.
- **Performance-Vorschlag:** Für ein noch festzulegendes Referenzsystem und ein Dashboard mit 20 Widgets gelten als erste Diskussionswerte: erste bedienbare Ansicht innerhalb von 2 Sekunden im lokalen Netz und Anzeige einer eingehenden Zustandsänderung innerhalb von 500 ms. Hardware, Browser, Netzwerk und Messmethode müssen vor Abnahme bestätigt werden; Werte können anhand eines Prototyps angepasst werden.
- **Serverlast:** Ereignisse sollen nur an interessierte Clients gehen. CPU- und Speicherverbrauch werden auf der festgelegten FHEM-Referenzhardware mit dokumentierter Anzahl von Geräten, Widgets und Ereignissen gemessen. Grenzwerte werden vor dem MVP-Abnahmetest festgelegt.
- „60 FPS“ ist kein pauschales Abnahmekriterium für alle Zielgeräte. Animationen dürfen die Bedienung nicht blockieren; die Leistung wird auf der vereinbarten Referenzhardware geprüft.

### MVP-Vorschlag und Abnahmekriterien

Der MVP-Vorschlag umfasst:

1. Statische CMS-Dateien liegen unter `www/fhem-cms/` und werden von FHEMs normaler `www`-Auslieferung bereitgestellt; das Steuerungsmodul bedient keine HTML- oder Asset-Seiten selbst.
2. Beim Anlegen eines CMS-Devices wird für dessen initiale Oberfläche eine HTML-Bootstrap-Datei unter `www/fhem-cms/<device>/<oberflaeche>/index.html` erzeugt. Sie lädt die gemeinsamen Assets und startet dieses Device und diese Oberfläche.
3. Die HTML-Datei lädt und speichert eine validierte JSON-Konfiguration, die nach einem FHEM-Neustart erhalten bleibt.
4. Eine SPA mit mindestens einer Seite, Navigation und responsivem Layout.
5. Einen einfachen Text-/Markdown-Baustein.
6. Ein lesendes FHEM-Widget, das ein Reading initial und bei Änderungen darstellt.
7. Begrenzte Datenabonnements sowie erkennbare Lade-, Offline-, Fehler- und Berechtigungszustände.
8. Geprüfte Sicherheits-, Performance- und Serverlastkriterien auf der vereinbarten Testumgebung.

**Vorgeschlagene Nicht-Ziele des MVP:** schreibende FHEM-Steuerung, Bild-Uploads, Kalender, Wetter, RSS, externe Medien und Community-Plugins. Diese Funktionen können nach dem MVP als eigene Stories aufgenommen werden.

Der MVP-Umfang, das Referenzsystem und vorgeschlagene Leistungswerte werden in der Storyliste zuerst gemeinsam bestätigt. Eine Roadmap-Phase gilt erst als abgeschlossen, wenn ihre Akzeptanzkriterien erfüllt sind, passende Tests vorliegen und die Entwicklerdokumentation aktualisiert ist.

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
