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

Das Device erscheint im Raum `FHEM CMS` mit den Links `CMS starten` und `Zeige Homepage`. Alternativ: `get CMS url`.
Neu angelegte Devices verwenden Schema 5 mit 12 Spalten. Vorhandene
Konfigurationen behalten ihr bisheriges Format bis zur bestätigten Umstellung.
Fehlt die Live-Konfiguration in einem bereits vorhandenen Datenverzeichnis oder
fehlt bei einer vorhandenen Startseite das ganze Datenverzeichnis, werden die
Daten nicht neu angelegt: In diesem Fall die Sicherung prüfen und wiederherstellen.

## Updates einspielen

Nach `update all …` hängt das weitere Vorgehen davon ab, was sich geändert hat:

| Geändert | Nötig |
|---|---|
| Nur Frontend-Dateien (`www/fhem-cms/`: JS, CSS, Komponenten) | `set <CMS> rebuild`, dann Browser hart neu laden. Ein Neustart ist nicht nötig. |
| Das Modul (`FHEM/01_FHEMCMS.pm`) | Neustart (`shutdown restart` oder `sudo systemctl restart fhem`). Ein zusätzliches `rebuild` ist dann überflüssig. |

`rebuild` erzeugt nur die Startseite `www/fhem-cms/<Device>/index.html` neu und aktualisiert dabei die Versionsparameter, damit der Browser die neuen Dateien lädt. Konfiguration, Entwurf und Backups bleiben unberührt. Dieselbe Neuerzeugung läuft automatisch bei jedem FHEM-Start. Meldet `update` „nothing to do“, obwohl es Änderungen gibt, ist meist das Manifest auf GitHub noch nicht fertig (ein bis zwei Minuten nach dem Push) oder gecacht.

## Umstellung und Wiederherstellung testen

Im Bearbeitungsmodus steht bei alten CMS-Devices **Jetzt umstellen** direkt über
dem Editor. Ein Klick stellt alle Seiten auf Schema 5 mit 12 Spalten um.
Es gibt keine Rastervorschau, Sicherungs-Checkbox oder Einzelbestätigung mehr.
Alternativ `/fhem/fhem-cms/examples/migration-preview.html` öffnen, das CMS-Device
eingeben und denselben Button wählen (FHEMWEB-Webnamen gegebenenfalls anpassen).
In FHEM ist auch `set <CMS> layoutupgrade` möglich.

Alle gespeicherten Widgets, Einstellungen, Seiten und beide Platzhalterformen
bleiben erhalten. Live und ein vorhandener Entwurf werden **getrennt** umgestellt:
Der Entwurf wird weder veröffentlicht noch verworfen. Die Navigation erhält die
erste Rasterzeile; Widgets werden in ihrer bisherigen Reihenfolge mit drei Kacheln
je Zeile neu angeordnet. Positionen und Größen danach im Editor anpassen.
Medien werden nicht verändert. Neue Devices starten bereits in Schema 5.

Vor dem Austausch prüft das Modul beide Konfigurationen und erstellt bytegenaue
Sicherungen. Auf der separaten Umstellungsseite werden Live- und Entwurfssicherung
mit ihren jeweiligen Dateinamen angezeigt; beim Button direkt im Editor stehen
die Namen im FHEM-Log. Die Dateien liegen im CMS-Datenverzeichnis.
Ein kleines `layout-upgrade.json`-Journal hält einen begonnenen Auftrag fest.
Bei einem Abbruch bleiben die Sicherungen erhalten; Zugriffe auf ein gemischtes
Layout werden gesperrt. Beim Neustart wird derselbe Auftrag abgeschlossen.
Extern veränderte oder ungültige Daten werden nicht überschrieben.
Bei einer Fehlermeldung zuerst Zustand, Journal und Sicherungen prüfen; nicht
blind weitere Schreibbefehle ausführen.

Eine vollständige externe Sicherung von FHEM-Konfiguration, CMS-Daten, Medien,
Modul und Assets bleibt vor Tests empfohlen. Die automatische Sicherung umfasst
nur Konfigurationsdateien und ist keine Zusicherung gegen Stromausfall oder
gleichzeitige externe Dateischreiber.

Für eine Wiederherstellung im Schema-5-Editor **Sicherungen / Wiederherstellung**
im Menü **Datei** öffnen. Der Dialog lädt die Backups, zeigt nach `Backup prüfen`
Live und Backup zum Vergleich, verlangt die Bestätigung der geprüften externen
Sicherung und stellt erst mit `Backup wiederherstellen` wieder her. Ein vorhandener
Entwurf muss nur für diese Wiederherstellung vorher veröffentlicht oder verworfen werden.
Eine Entwurfssicherung wird beim Restore nicht automatisch als Entwurf erkannt:
Die ausgewählte Datei ersetzt immer den Live-Stand. Für einen vollständigen
Rollback mit Entwurf beide Originaldateien bei gestopptem FHEM aus den jeweils
zugehörigen Sicherungen wiederherstellen.

`version5draft` und `migrationcommit` sind interne Schnittstellen für die Oberfläche,
keine direkt auszuführenden Set-Menüpunkte.

Für einen Rollback auf eine ältere CMS-Version ausschließlich eine zusammengehörige
vollständige Code-, Asset- und Datensicherung auf einer isolierten Instanz
wiederherstellen: Ältere Module können Schema 5 nicht sicher interpretieren.
Die automatische Konfigurationssicherung enthält keine Medien oder FHEM-Konfiguration.

## Schema-5-Editor bedienen

- **Datei:** Entwurf veröffentlichen/verwerfen sowie Sicherungen und Wiederherstellung.
- **Bearbeiten:** Seiteneinstellungen (Theme, Widget-Rahmen, Titelausrichtung und Rastergröße)
  und Widget hinzufügen (mit Suche).
- **Ansicht:** Vorschau (zeigt die Seite ohne Bearbeitungselemente) und Raster anzeigen.

Die Geräteauswahl oben rechts im Editiermodus bietet Smartphone- und
Tabletprofile sowie verschiedene Desktopauflösungen. Die Drehfunktion wechselt
zwischen Hoch- und Querformat. Die Vorschau zeigt den responsiven Entwurf,
ohne die gespeicherten Desktoppositionen zu verändern; zum Positionieren und
Skalieren der Widgets zurück in den Editor wechseln.

Unter **Bearbeiten → Seiteneinstellungen → Rastergröße** wählen Sie 12, 24, 48,
96 oder 192 Spalten: mehr Spalten erlauben feinere Positionen und Größen. Die Auswahl gilt
für alle Seiten und die gemeinsame Navigation. Bestehende Positionen und Größen
werden proportional in beiden Richtungen umgerechnet. Beim Vergröbern werden
sie gerundet; Überschneidungen werden durch Verschieben nach unten aufgelöst.
Die Umrechnung erfolgt erst mit **Speichern** als Entwurf. **Abbrechen**
verändert weder Live noch den vorhandenen Entwurf. Der Dialog enthält nur
Layout- und Look-&-Feel-Einstellungen, keine Widgetpositionen oder -größen.
Widgets werden ausschließlich direkt im Editiermodus verschoben und skaliert.

**Widgettitel ausrichten (alle Seiten)** legt linksbündige, zentrierte oder
rechtsbündige Titel für alle Widgets dieses CMS-Devices fest. Ohne Einstellung
bleiben Titel linksbündig. Die Auswahl wird als Entwurf gespeichert und gilt auch
in der Vorschau; nach dem Veröffentlichen in der Homepage. Dialogüberschriften
und Textformatierungen innerhalb von Text-/HTML-Widgets bleiben unverändert.

### Fenstergröße, Browser-Zoom und Drehen

Homepage und Vorschau passen die Anordnung automatisch an die verfügbare
Inhaltsbreite an, auch beim Drehen eines Smartphones oder Tablets. Widgets und
Navigationsschaltflächen wachsen bzw. schrumpfen gemeinsam mit der Fensterbreite.
Der Browser-Zoom wird dabei nicht mehr durch vollständiges Einpassen aufgehoben:
Hineinzoomen vergrößert Kacheln und Beschriftungen sichtbar, Hinauszoomen verkleinert
sie. Bei Platzmangel rutschen Widgets in die nächste Zeile, statt horizontal aus
dem Fenster zu laufen. Die Zeilen können deshalb auch auf dem Desktop von den
gespeicherten Rasterpositionen abweichen; diese werden nicht verändert.

Die gespeicherte Rasterbreite bestimmt die relative Kachelgröße; kleine Widgets
erhalten mindestens ein Viertel der Bezugsbreite. Breite und Höhe verwenden
dieselbe Skalierung, das gespeicherte Seitenverhältnis bleibt erhalten, mit
mindestens 6 rem Höhe (bei Standardschrift 96 Pixel). Zwei kleine Widgets passen
weiterhin auf übliche Smartphonebreiten. Der Umbruch hängt vom tatsächlichen
Platzbedarf ab, nicht mehr von festen Geräte-Breakpoints.

Die Navigation steht vor den Widgets. Auch ihre konfigurierten Buttonbreiten
und -höhen skalieren mit; Pixelangaben beziehen sich auf 1200 Pixel Inhaltsbreite
bei Standardschrift. Passen alle sichtbaren
Menüeinträge einschließlich Abständen in ihre verfügbare Breite, bleiben sie
direkt sichtbar; andernfalls erscheint das aufklappbare ☰-Menü. Die Platzprüfung
reagiert auf Drehen, Größenänderungen, Beschriftungen und geladene Schriften.
Widgets folgen ihrer ursprünglichen Zeilen-/Spaltenreihenfolge.
Die Anordnung ist unabhängig von der gewählten Rasterdichte.
Beim Drehen oder Vergrößern bleiben Inhalte und Live-Daten bestehen; es werden
keine Positionen gespeichert. Im Editor selbst bleibt das präzise Raster aktiv.
Zum Prüfen der Umbrüche dort die Geräte-Vorschau verwenden.

Die mobile Ansicht funktioniert auch beim Start über ein iPhone-Homescreen-Icon.
Nach dem Drehen bleiben die Kachelabstände erhalten; das Navigationsmenü wird
anhand des tatsächlich verfügbaren Platzes erneut geprüft.

### Navigation und Widgets bearbeiten

Das Stiftsymbol an der Navigation öffnet **Navigation bearbeiten** – die zentrale
Seitenverwaltung: Reihenfolge am ≡-Griff ziehen (oder Pfeiltasten), je Seite
Dateiname, Seitentitel, Beschriftung, Größe und der Haken **Anzeigen**, dazu
„Neue Seite erstellen“ und das Löschen leerer Seiten. Ohne „Anzeigen“ erscheint
eine Seite nicht in der veröffentlichten Navigation, bleibt im Bearbeitungsmodus
aber gedimmt erreichbar – zum Vorbereiten neuer Seiten oder als Parkplatz für
gerade nicht benötigte Widgets. Unter „Größe für alle Navigationspunkte“
überstimmen gemeinsame Werte die Einzelgrößen, bis die Option wieder
deaktiviert wird. Feste Größen wirken als Maximum: Auf schmalen Kacheln und
Fenstern schrumpfen die Punkte mit. Im Schema-5-Renderer entscheidet die
tatsächlich benötigte Menübreite statt eines festen Bildschirm-Breakpoints
über das ☰-Menü.

Alle Dialoge haben unten die Knöpfe **Speichern** und **Abbrechen**: Speichern
übernimmt die Änderungen als Entwurf und schließt den Dialog, Abbrechen verwirft
die Eingaben.

Widgets am Punktgriff oben rechts ziehen. Am markierten Griff unten rechts
Breite und Höhe ändern. Der Widget-Titel ist zugleich der interne Name in den
Verwaltungsdialogen; der Haken „Titel anzeigen“ im Widget-Dialog blendet ihn
auf der Kachel ein oder aus. Das Stiftsymbol öffnet direkt die Widgeteinstellungen
(einheitlich mit „Widget löschen“ zum Entfernen); das ⇄-Symbol verschiebt das
Widget auf eine andere Seite, wo es unterhalb der vorhandenen Inhalte einsortiert
wird. Bei der Navigation öffnet das Stiftsymbol deren Einstellungen. Auch die
Navigation ist verschiebbar und skalierbar. Änderungen werden automatisch **nur als Entwurf** gespeichert.
Erst **Datei → Entwurf veröffentlichen** ändert die Homepage.
Andere Widgets derselben Seite können beim Ziehen ausweichen; ihre neuen
Positionen werden gemeinsam gespeichert. Die Navigation gilt für alle Seiten:
Würde ihre neue Position dort kollidieren, wird die Änderung sichtbar abgelehnt
und das vorherige Raster wieder angezeigt.

Während der Speicherung sind weitere Änderungen gesperrt. Bei einer verlorenen
oder unklaren Antwort zuerst **Zustand erneut laden**, nicht blind wiederholen.
Einstellungen öffnen als kompakte
Dialoge; **Abbrechen** oder Escape schließt sie, bei ungespeicherten Änderungen
mit Rückfrage.

## Sicherheit: FHEMWEB absichern

Das CMS liest und schreibt über FHEMWEB. Ist FHEMWEB nicht abgesichert (FHEM meldet beim Start „WEB is not password protected“), kann jeder im Netz die CMS-Konfiguration ändern und Sollwerte setzen. Bitte vor dem produktiven Einsatz ein `allowed`-Device anlegen:

```text
define allowed allowed
attr allowed validFor WEB
attr allowed basicAuth <base64 von benutzer:passwort>
```

Das CMS speichert keine Zugangsdaten und erlaubt keine fremden Origins (kein CORS).

## Bedienung

Die folgenden Beschreibungen betreffen vor allem das bisherige 48-Spalten-Format.
Im 12-Spalten-Format stehen im Bearbeitungsmodus separate Schaltflächen für Raster,
Seiten, Widgets, Navigation und Darstellung zur Verfügung. Änderungen werden als
Entwurf gespeichert und erst nach Bestätigung veröffentlicht. Die normale
Homepage zeigt Live, `?mode=preview` den Entwurf und `?mode=edit` den Editor.

- **Navigation:** Die Seite hat keinen Kopfbereich mehr; eine Überschrift schreiben Sie bei Bedarf selbst in einen Textbaustein. Die Navigation ist ein eigenes Widget und gilt auf allen Seiten gleich. Im Bearbeitungsmodus öffnet der Button `Navigation` (links in der Werkzeugleiste) einen Dialog: Ausrichtung horizontal oder vertikal, Seiten mit `+ Seite` anlegen, per Ziehen am ☰-Griff umsortieren, mit ✎ umbenennen und mit ✕ löschen (die letzte Seite kann nicht gelöscht werden). Beim Löschen einer Seite mit Widgets fragt der Dialog, ob die Widgets vorher verschoben werden sollen; wenn ja, wählen Sie je Widget eine Zielseite, Widgets ohne Zielseite („– löschen –“) werden mit der Seite gelöscht. Änderungen im Dialog gelten erst nach `Speichern`; `Abbrechen` verwirft sie. Im Layout-Modus lässt sich die Navigation wie jede Kachel verschieben und in der Größe ändern. Seiten sind per Link `#/<id>` aufrufbar.
- **Widgets:** `+ Widget` fügt eine Thermostat-Kachel oder einen Textbaustein hinzu. Das Zahnrad an der Kachel öffnet die Konfiguration. Beim Thermostat kann ein Hauptdevice oder ein einzelner Kanal gewählt werden. Genau dieses Device wird übernommen; bei einem Hauptdevice werden zusätzlich dessen Kanäle nach Readings durchsucht. Ein Gerätewechsel aktualisiert sofort die Reading-Auswahl im Dialog; Solltemperaturbereich und Betriebsarten ergeben sich danach aus den Set-Befehlen des neu zugeordneten Geräts. Erst „Speichern“ übernimmt die Änderung, „Abbrechen“ erhält die bisherige Konfiguration. Der Dialog filtert pro Spalte (Device, Alias, Typ, Raum). Unter dem gewählten Device steht – falls vorhanden – sein Alias. Die Thermostat-Kachel setzt die Solltemperatur (Bereich aus dem Gerät, 0,5-Schritte) und die Betriebsart (Auswahlfeld, nur wenn das Gerät sie anbietet); bei kleiner Kachel werden weniger Details gezeigt.
  **Darstellung der Thermostat-Kachel** (wie im Thermostat-Dashboard): kleiner Titel als Label oben links (kein Kopfbereich, keine Linie); darunter zwei Boxen „Isttemperatur“ und „Solltemperatur“ (Zahl groß, Einheit °C klein, unter der Solltemperatur der Schieber); unten eine Zeile mit Betriebsart-Auswahl (abgerundeter Metallic-Knopf mit Doppelpfeil), Ventilbalken mit Prozentwert (blau bis rot, weiße Marke) und Batterie-Symbol mit Zustand. Die Wert-Anzeige zeigt Icon und Wert mittig in der Kachel; ein gesetzter Titel steht als kleines Label oben links. Alle Kacheln haben einen dünnen Rahmen mit stark abgerundeten Ecken (Stil wie in FTUI); das Zahnrad sitzt klein oben rechts und ist nur im Bearbeitungsmodus sichtbar. Der Inhalt jeder Kachel sitzt oben an der Kante und ist kompakt gesetzt; überschüssiger Platz bleibt unten frei. Je nach Kachelform wechselt das Thermostat das Layout: breit und flach zweispaltig, hoch und schmal einspaltig (Ist-Box über Soll-Box, Modus/Ventil/Batterie am unteren Rand), sodass die Kachel möglichst ausgefüllt ist. Das Raster nutzt die volle Fensterbreite; Spaltenbreite, Abstand und Zeilenhöhe wachsen und schrumpfen gemeinsam, sodass Raster und Kacheln beim Ändern der Fenstergröße oder des Browser-Zooms flüssig mitskalieren. Erst unterhalb von ca. 40 rem Breite (stark hineingezoomt oder Handy) werden die Kacheln einspaltig untereinander gezeigt. Der gesamte Inhalt skaliert proportional zur Kachelgröße (Schrift, Boxen, Schieber), sodass er die Kachel ohne große Leerflächen füllt. Wird sie sehr klein, entfallen zuerst die Batterie, dann die untere Zeile, dann der Schieber und zuletzt die Titelzeile; ganz klein bleibt nur die Solltemperatur.
- **Navigationseinträge:** Im Navigations-Dialog öffnet ⚙ je Seite Beschriftung (Standard: Seitenname), Breite und Höhe in Pixeln. Ohne eigene Maße haben alle Einträge die Größe des größten Eintrags.
- **Textfarbe und Hervorhebung:** Im Editor Text markieren, `Farbe` öffnen, Farbe wählen und `Anwenden`; `Entfernen` nimmt die Farbe zurück.
- **Wert-Anzeige:** `Einfügen → Wert-Anzeige` zeigt ein Reading eines beliebigen Devices als große Zahl. Im Dialog wählen Sie das Device wie bei der Thermostat-Kachel über „Auswählen …“ (Suchdialog mit Filtern je Spalte), danach das Reading aus der Liste der Readings dieses Devices, optional ein Titel (steht klein über dem Wert), optional eine Einheit (Vorschläge wie °C, %, km, kWh – oder frei eintippen) und ein Icon aus dem Icon-Verzeichnis von FHEM (Filterfeld, Klick auf das Icon). Das Icon steht vor dem Wert, die Einheit dahinter. Ohne Wert erscheint „–“. Der Wert aktualisiert sich live.
- **Uhr / Datum:** Über `Einfügen → Uhr / Datum` wählen Sie eine digitale Uhr, eine digitale Uhr mit Datum oder eine Analoguhr. Sekunden, Datum und Wochentag lassen sich ergänzend einblenden. Die Anzeige verwendet die lokale Zeit des Browsers.
- **Status-Symbol:** Über `Einfügen → Status-Symbol` wählen Sie Device und Reading und legen Wert-Zuordnungen mit Icon und Farbe an. Nicht zugeordnete Reading-Werte erscheinen als Text; das Widget liest nur und sendet keine FHEM-Befehle.
- **SolarFlow:** Über `Einfügen → SolarFlow` wählen Sie zuerst, ob die Werte aus einem Device (Standard) oder aus mehreren Devices kommen. Bei einem Device wählen Sie es einmal und danach nur noch die Readings für PV, Haus, Netz, Batterie und Ladestand; bei mehreren Devices wählen Sie für jede Station Device und Reading getrennt (höchstens 5 Devices). Die Darstellung skaliert mit der Kachelgröße. Nur die PV-Leistung ist Pflicht; fehlt das Reading für den Hausverbrauch, wird er berechnet, ohne Netz- oder Batterie-Reading entfällt die Station. Die Werte werden unverändert aus dem Device übernommen: negativ ist schlecht (Netzbezug, Batterie entlädt, roter Ring), positiv ist gut (Einspeisung, Batterie lädt, grüner Ring). Die Einheit W oder kW ist wählbar. Die Verbindungen sind immer grau und gleich dick; nur die Punkte zeigen den Fluss, Tempo und Punktanzahl wachsen mit der Leistung. Unterhalb des Schwellwerts laufen keine Punkte. Bei der Einstellung „Bewegung reduzieren“ des Systems stehen die Punkte still. Das Widget liest nur.
- **Schieberegler:** `Einfügen → Schieberegler` bietet Devices mit einem Slider-Set-Befehl an. Bereich und Schrittweite werden aus der FHEM-Set-Beschreibung übernommen; das aktuelle Reading wird angezeigt. Änderungen werden 1,5 Sekunden nach der letzten Bewegung gesendet.
  - *Voraussetzung für die Auswahl:* Das Device muss in seiner Set-Liste (`set <device> ?`) einen Befehl der Form `<name>:slider,<min>,<step>,<max>` melden, zum Beispiel `pct:slider,0,1,100`. Es gibt keine feste Liste von Devicetypen; Devices ohne Slider-Hinweis erscheinen nicht.
  - *Thermostate:* Sie melden die Solltemperatur oft als Werteliste (`desired-temp:5,5.5,…,30`) statt als Slider und werden deshalb derzeit nicht angeboten. Die Erkennung solcher Wertelisten ist als Erweiterung geplant.
- **Diagramm:** `Einfügen → Diagramm` zeigt den Verlauf eines Readings als Liniendiagramm mit Min-/Max-Band sowie letztem, kleinstem und größtem Wert. Nach Auswahl des Devices bietet der Dialog die Readings an, die tatsächlich geloggt werden. Einheit, Standard-Zeitraum (24 Stunden, 7, 30 oder 365 Tage), Granularität (automatisch, Rohdaten, 15 Minuten, 1 Stunde, 1 Tag) und Datenquelle sind einstellbar; Besucher können Zeitraum und Granularität in der Kachel vorübergehend umschalten. Das Diagramm wird alle 5 Minuten aktualisiert.
  - *Datenquellen:* DbLog (Vorrang) oder FileLog, wie beim TemperatureCollector. Standardmäßig wird das erste passende DbLog- bzw. FileLog-Device verwendet; mit den Attributen `dbLog`, `fileLog` (Device-Name) und `historySource` (`auto`, `dblog`, `filelog`) am CMS-Device lässt sich das festlegen. Beim FileLog muss dessen Regexp das Reading abdecken.
  - *Grenzen:* höchstens 400 Punkte je Diagramm (längere Zeiträume werden zu Mittelwert, Minimum und Maximum zusammengefasst), Ergebnisse werden 30 Sekunden zwischengespeichert. Nur numerische Werte werden dargestellt.
  - *Hinweis:* DbLog-Abfragen sind in FHEM synchron und blockieren FHEM für die Dauer der Abfrage. Bei großen Datenbanken sollten Sie lange Zeiträume sparsam einsetzen.
- **Tabelle:** `Einfügen → Tabelle` zeigt Readings in einer laufend aktualisierten Tabelle. Im Dialog wählen Sie zuerst, ob die Werte aus einem Device (Standard) oder aus mehreren Devices kommen: Bei einem Device wählen Sie es einmal und danach je Zeile nur noch das Reading; bei mehreren Devices wählen Sie je Zeile Device und Reading. Beim Umschalten bleiben die Zeilen erhalten. Optional blendet eine Summenzeile unter der Tabelle die Summe der numerischen Einzelwerte ein (Beschriftung Standard „Summe“, änderbar); die Einheit ist wählbar oder „Automatisch“ (nur wenn alle summierten Werte dieselbe haben); die Beschriftung kann auch ausgeblendet werden, dann steht nur der Wert da. Die Tabellenüberschrift lässt sich ganz ausblenden; die Überschrift der Wertespalte (Standard „Wert“, rechtsbündig) ist änderbar oder einzeln ausblendbar. Die Überschrift der Geräte-/Bezeichnungsspalte ist anpassbar; Readings bleiben intern und werden nicht als eigene Spalte angezeigt. Für jeden Wert können gängige Einheiten wie °C, km, m, %, W oder kWh sowie eine eigene Einheit gewählt werden. Als Name einer Zeile erscheint der FHEM-Alias, sonst der Device-Name; im Feld „Bezeichner“ lässt sich ein eigener Name vergeben.
- **Freies HTML:** Menü `Einfügen` → `Freies HTML`. Im Dialog tragen Sie eigenen HTML-Code ein und setzen Werte aus FHEM mit Platzhaltern ein, z. B. `{{Wohnzimmer:temperature|round(1)}}`; die Anzeige aktualisiert sich live. Alternativ im FTUI-Stil: `<span device="Wohnzimmer" reading="temperature"></span>`. Mit `data-cms-class` ändern sich Klassen (Farben) je nach Zustand. Skripte, Bilder, Formulare und Ereignis-Attribute sind aus Sicherheitsgründen nicht erlaubt. Die Platzhalter-Hilfe steht im Dialog; ausführlich in [PLATZHALTER.md](PLATZHALTER.md).
- **Taster:** Menü *Einfügen* → *Taster*. Device wählen, einen Befehl aus dessen Befehlen ohne Parameter (z. B. `toggle`, `on`, `up`) festlegen, optional Beschriftung und Icon. Ein Klick in der Ansicht sendet den Befehl; im Bearbeitungsmodus wird nichts gesendet.
- **Schalter:** Menü *Einfügen* → *Schalter*. Device wählen (nur Devices mit passenden Befehlen), Reading für den Zustand (meist `state`) sowie die Befehle für „An“ und „Aus“ festlegen, optional Icons. In der Ansicht schaltet ein Klick; im Bearbeitungsmodus wird nicht geschaltet.
- **Platzhalter suchen:** Im freien HTML (Knopf *Platzhalter suchen und einfügen …*) und im Textbaustein (Knopf `{{ }}`) suchen Sie ein Device und ein Reading und fügen den Wert ein; im Textbaustein lässt sich der Platzhalter per Klick nachträglich ändern und wie normaler Text formatieren (fett, kursiv, unterstrichen, durchgestrichen, Farbe, Hervorhebung). Details in [PLATZHALTER.md](PLATZHALTER.md).
- **Textbaustein:** WYSIWYG-Editor mit Fett, Kursiv, Unterstrichen, Durchgestrichen, Überschriften, Listen, Ausrichtung, Links, Tabellen und Bildern. Bilder (PNG, JPEG, GIF, höchstens 3 MiB) werden hochgeladen oder aus bereits vorhandenen gewählt; ein Klick auf das Bild öffnet Position (links, Mitte, rechts, voll) und Alternativtext. Die Größe ändern Sie am grünen Ziehpunkt unten rechts am Bild: ziehen (das Seitenverhältnis bleibt erhalten, feinste Auflösung 1 % der Textbreite) oder den Ziehpunkt fokussieren und die Pfeiltasten nutzen. Der Text wird beim Einfügen und Speichern bereinigt, Skripte und fremde Bildquellen sind nicht möglich. Alte Markdown-Bausteine werden beim Bearbeiten umgewandelt.
- **Zwei Einstiege am Device:** Beide Links öffnen ein neues Browserfenster. „CMS starten“ öffnet den Bearbeitungsmodus (`?mode=edit`). „Zeige Homepage“ öffnet die Seite ohne Parameter (Standard), also nur die fertige Seite ohne Kopf, Werkzeugleiste und Zahnräder. Die Seitennavigation und die Kachelwerte bleiben. Achtung: Das ist nur eine Ansicht und keine Zugriffssperre, wer `?mode=edit` an die Adresse hängt, kann bearbeiten. Schutz bieten nur `allowed` und FHEMWEB.
- **Vorschau:** Öffnet in einem neuen Fenster den aktuellen Entwurf so, wie die Seite nach dem Veröffentlichen ausgeliefert würde (ohne Bearbeitungsknöpfe). Der Entwurf wird bei jeder Änderung gespeichert, ein Neuladen des Vorschaufensters zeigt den neuesten Stand.
- **Kacheln verschieben und skalieren:** Im Bearbeitungsmodus ist das immer möglich (kein eigener Modus). Jede Kachel hat oben rechts nebeneinander die Symbole ⇄ („Widget auf andere Seite verschieben“), ⠿ („Widget auf dieser Seite verschieben“, Griff) und ⚙ („Widget konfigurieren“); Ziehen mit Maus oder Touch, oder Griff fokussieren und Pfeiltasten nutzen. Die Größe ändern Sie am Griff unten rechts der Kachel, der beim Darüberfahren erscheint (ziehen) oder mit Umschalt+Pfeiltasten am fokussierten Kachel-Griff. Position und Größe rasten im gewählten Raster ein (12, 24 oder 48 Spalten, siehe „Seite einrichten“). Was mit anderen Kacheln passiert, hängt von der Positionierung ab: Im Raster rutschen überlappende Kacheln nach unten, bei Fluss und Spalten ordnen sich alle neu an, bei Frei bleiben sie unberührt. Verdrängte Kacheln gleiten an ihren neuen Platz. Das Layout wird gespeichert. Der Konfigurationsdialog der Kacheln enthält keine Rasterfelder mehr. Der Knopf ⇄ oben rechts an jeder Kachel verschiebt sie auf eine andere Seite (unten angehängt, Konfiguration bleibt erhalten); das gilt für alle Widget-Typen. Auf schmalen Bildschirmen ist der Modus ausgeblendet.
- **Farbschema:** Im Bearbeitungsmodus unter „Datei › Seite einrichten …“ das dunkle oder helle Theme wählen. Die Auswahl gilt für das gesamte CMS-Device und wird mit dem Entwurf erst nach „Veröffentlichen“ auf der Homepage sichtbar.
- **Geräte-Vorschau:** Auch im Schema-5-Bearbeitungsmodus wählen Sie oben rechts ein Gerät (iPhone, iPad, Android oder Desktop-Auflösung). Der Entwurf erscheint in einem Rahmen mit der echten Bildschirmgröße und wird bei Bedarf verkleinert, damit er ins Fenster passt. Die Seite reagiert wie auf dem Gerät. Mit ⟳ wechseln Sie zwischen Hoch- und Querformat; „Vorschau: Aus“ oder Esc schließt die Ansicht.
- **Seite einrichten:** `Datei › Seite einrichten …` öffnet einen Dialog mit seitenübergreifenden Einstellungen: **Theme** (Dunkel/Hell; ersetzt die früheren Einträge im Menü „Ansicht“) und **Rahmen am Widget anzeigen** (ja/nein). Dazu kommt die **Positionierung** (mit Vorschau je Modus): **Raster** (feste Zellen, Überlappendes rutscht nach unten), **Fluss** (Reihenfolge links nach rechts mit automatischem Umbruch), **Spalten/Masonry** (lückenlos von oben nach unten) und **Frei** (beliebig platzieren, Überlappung erlaubt). Die **Rastergröße** (12/24/48 Spalten) bestimmt die Schrittweite beim Verschieben und Skalieren; bei „Frei“ gilt immer 48. Beim Wechsel werden alle Seiten umgerechnet, die Positionen bleiben im 48er-Raster gespeichert. Die Einstellungen gelten für alle Seiten und werden im Entwurf gespeichert (`theme`, `settings.showFrames`, `settings.layoutMode` = `grid`/`flow`/`masonry`/`free`, `settings.gridColumns` = 12/24/48).
- **Werkzeugleiste und Meldungen:** Die Leiste ist eine Menüleiste wie in klassischen Programmen mit den Menüs **Datei** (Seite einrichten …, Vorschau, Veröffentlichen, Entwurf verwerfen, Backups …, Daten löschen …), **Bearbeiten** (Navigation bearbeiten …), **Einfügen** (Thermostat-Kachel, Wert-Anzeige, Schalter, Taster, Freies HTML, Uhr / Datum, Status-Symbol, Tabelle, Schieberegler, Diagramm, SolarFlow, Textbaustein) und **Ansicht** (Raster anzeigen, mit Häkchen) (sie schwebt oben links in Blau über der Seite, auf gleicher Höhe wie die Geräte-Auswahl rechts, und gehört nicht zum Inhaltsraster; Kacheln lassen sich bis ganz nach oben schieben). Meldungen (z. B. „Layout gespeichert“, Hinweis auf einen unveröffentlichten Entwurf) erscheinen als rotes Ausrufezeichen oben rechts; ein Klick darauf öffnet eine kleine Box mit den Meldungen (Klick daneben oder Esc schließt sie). Im Ansichtsmodus erscheinen nur akute Fehler.
- **Raster anzeigen:** Im Menü Ansicht blendet „Raster anzeigen“ das Raster des Seiteninhalts als Gitterlinien ein oder aus (wird im Browser gemerkt). Es erscheint nur im Bearbeitungsmodus und folgt der gewählten Rastergröße.
- **Wiederherstellen per Modul:** `set <CMS> restore` bietet die 20 neuesten Backups als Auswahlliste an.
- **Entwurf und Veröffentlichen:** Änderungen im Bearbeitungsmodus landen in einem Entwurf. „Zeige Homepage“ zeigt weiter den bisherigen Live-Stand. `Veröffentlichen` übernimmt den Entwurf als Live-Stand, `Entwurf verwerfen` löscht ihn. Es gibt einen Entwurf pro Device; bearbeiten zwei Personen gleichzeitig, gewinnt die letzte Speicherung.
- **Backups:** Jede Veröffentlichung sichert den bisherigen Live-Stand als Backup. `Backups` zeigt die Liste; ein Klick stellt den Live-Stand nach Bestätigung wieder her (der aktuelle Live-Stand wird vorher gesichert). Ein offener Entwurf bleibt dabei unverändert.
- **Unbekanntes Datenformat:** Meldet ein Schreibbefehl eine nicht unterstützte `schemaVersion` in Live-Daten oder Entwurf, werden Speichern, Veröffentlichen, Verwerfen und Wiederherstellen zum Schutz der Daten abgelehnt. Sichern Sie die Daten und verwenden Sie den zum Datenformat passenden CMS-Stand. Bei beschädigtem JSON können Sie einen Entwurf ausdrücklich verwerfen oder ein gültiges Backup wiederherstellen; beim Verwerfen geht der Entwurf verloren.
- **CMS-Daten löschen:** Unter `Datei → Daten löschen …` zeigt der Dialog die beiden betroffenen Device-Ordner sowie die Folgen. `Behalten` schließt den Dialog ohne Änderung, `Abbrechen` verwirft die Aktion. `Daten endgültig löschen` entfernt Konfiguration, Entwurf, Backups, Medien und Startseite; danach muss das FHEM-Device gelöscht oder FHEM neu gestartet werden.
- **Verbindungsabbruch:** Die Kachel zeigt die letzten Werte gedämpft mit „Veraltet seit …“, der Regler ist gesperrt. Nach Wiederherstellung der Verbindung wird sofort neu gelesen.

## Dateien und Daten

| Pfad | Inhalt |
|---|---|
| `<modpath>/www/fhem-cms/` | Gemeinsame Frontend-Dateien (werden durch `update` ersetzt) |
| `<modpath>/www/fhem-cms/<Device>/index.html` | Generierte Startseite (nicht bearbeiten) |
| `<modpath>/fhem-cms-data/<Device>/config.json` | Live-Konfiguration inkl. Backups (`config.json.<Zeit>.bak`) |
| `<modpath>/fhem-cms-data/<Device>/draft.json` | Offener Entwurf (nur vorhanden, solange nicht veröffentlicht) |

`fhem-cms-data` liegt außerhalb von `www` und wird nicht ausgeliefert. Das Betriebssystem-Konto von FHEM braucht dort Schreibrechte; empfohlen sind Verzeichnisrechte 0750 und Dateirechte 0640.

## Befehle

| Befehl | Wirkung |
|---|---|
| `get <CMS> url` | Pfad der Startseite |
| `get <CMS> config` | Konfiguration als JSON |
| `get <CMS> backups` | Liste der Backups |
| `get <CMS> draft` | Entwurf als JSON (ohne Entwurf der Live-Stand) |
| `get <CMS> status` | `{"draft":true|false}` |
| `get <CMS> logreadings <Device> [auto\|dblog\|filelog]` | Geloggte Readings eines Devices als JSON |
| `get <CMS> history <Device> <Reading> [24h\|7d\|30d\|365d] [auto\|raw\|15m\|1h\|1d] [auto\|dblog\|filelog]` | Verlauf eines Readings als JSON (Punkte `[Zeit, Mittel, Min, Max]`) |
| `set <CMS> config <Base64-JSON>` | Live-Konfiguration direkt speichern (wird validiert, mit Backup) |
| `set <CMS> draft <Base64-JSON>` | Entwurf speichern (ohne Backup) |
| `set <CMS> publish` | Entwurf als Live-Stand übernehmen (Backup des alten Stands) |
| `set <CMS> discard` | Entwurf verwerfen |
| `set <CMS> restore <Backupname>` | Backup wiederherstellen |
| `set <CMS> rebuild` | Startseite neu erzeugen (nach Updates der Frontend-Dateien; läuft auch bei jedem FHEM-Start) |
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

Für die noch nicht integrierte FCUI-Oberfläche lässt sich die Bereitstellung
der Bibliotheken separat prüfen: Im Browser unter dem FHEMWEB-Pfad
`fhem-cms/examples/fcui-check.html` öffnen, zum Beispiel
`/fhem/fhem-cms/examples/fcui-check.html`. Die Seite meldet Erfolg oder einen
Ladefehler. Sie ändert keine CMS-Daten und ersetzt keinen Test der späteren
Oberfläche.

## Fragen, Fehler und Ideen

Fragen, Fehler und Ideen bitte als [GitHub-Issue](https://github.com/stapetz/fhem-cms/issues/new/choose) melden. Issues sind öffentlich sichtbar und können von Suchmaschinen gefunden werden; bitte keine Passwörter, Tokens oder Adressen posten.
