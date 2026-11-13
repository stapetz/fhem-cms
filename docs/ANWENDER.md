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

## CMS-Systeme verwalten (dev, vorgesehen fuer 1.10.0)

Die zentrale Verwaltung ist direkt unter `/fhem/fhem-cms/admin.html` erreichbar
(bei abweichendem FHEMWEB-Pfad entsprechend anpassen). In jedem CMS oeffnet
**Datei → Globale CMS Administration** dieselbe Seite in einem neuen Tab,
auch im bisherigen Schema-4-Editor.
Der Button **CMS oeffnen** steht rechts in der jeweiligen CMS-Zeile.

- CMS-Devices per Checkbox auswaehlen und **Purge + Delete** starten.
- Der Bestaetigungsdialog nennt alle ausgewaehlten Devices. Erst die Eingabe
  `DELETE` gibt die unwiderrufliche Loeschung frei.
- Purge entfernt Konfiguration, Entwurf, Sicherungen und Medien. Nur nach
  erfolgreichem Purge wird das Device geloescht. Nach vollstaendig erfolgreicher
  Loeschung wird die Seite automatisch neu geladen. Bei Fehlern oder
  Teilerfolgen bleiben die Einzelergebnisse sichtbar; bei einem Verbindungsfehler
  vor einem weiteren Versuch den Bestand pruefen.
- Verwaiste Verzeichnisse geloeschter Devices erscheinen getrennt, mit ihrer
  Dateistruktur. Sie werden separat ausgewaehlt und bestaetigt. Unbekannte
  Verzeichnisse, fremde Dateien, Symlinks und Namen anderer Devices sind gesperrt.
- Hoechstens 20 Eintraege pro Vorgang. Ein zwischenzeitlich geaenderter Bestand
  muss neu geladen und bestaetigt werden.
- Es gelten die FHEMWEB-Berechtigungen fuer `get`, `set`, `delete` und den
  jeweiligen Device-Namen. Loeschen erfordert einen aktivierten
  FHEMWEB-CSRF-Token. Die Seite hat keine eigene Anmeldung.

Die Verwaltung erstellt kein automatisches Backup und fuehrt kein globales
`save` aus. Die geaenderte FHEM-Konfiguration nach Pruefung bei Bedarf in
FHEMWEB speichern. Ohne verbliebene CMS-Devices funktioniert die Verwaltung
weiter, solange das Modul in der laufenden FHEM-Sitzung geladen ist. Nach einem
Neustart ohne CMS-Device muss das Modul erst wieder geladen werden.

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

Einheiten zur Beschriftung werden in **Wert**, **Diagramm**, **Tabelle** und
im Platzhalterdialog einheitlich eingegeben: freies Textfeld mit anklickbaren
Vorschlägen darunter. Leeren bedeutet keine Einheit. Eigene Einheiten sind
möglich (höchstens 16 Zeichen). Die Summeneinheit einer Tabelle kann alternativ
automatisch aus den Einzelwerten übernommen werden; diese Automatik wird
separat ein-/ausgeschaltet. SolarFlow behält die begrenzte W/kW-Auswahl, weil
sie die Umrechnung seiner Leistungsreadings steuert.

Im Platzhalterdialog des Texteditors können Sie unter **Einheit hinter dem
Wert** etwa °C, W, kWh oder % anklicken oder eine eigene Einheit eingeben. Die Einheit wird hinter dem eingefügten
Reading angezeigt und beim erneuten Bearbeiten übernommen. Details stehen
unter [Platzhalter](./PLATZHALTER.md#platzhalter-suchen-statt-tippen).

Beim **SolarFlow** bleibt der sichtbare Titel oberhalb des Diagramms frei.
Das Diagramm skaliert in der verbleibenden Widgetfläche; bei ausgeblendetem
Titel steht diese Fläche wieder dem Diagramm zur Verfügung.

## Schema-5-Editor bedienen

Der Einrichtungsassistent wird bei einer neuen,
leeren CMS-Konfiguration einmal angeboten. Nach `purge` und Neuanlage erscheint
er erneut. Die manuelle Auswahl zeigt vor dem Speichern eine Vorschau; **Magic -
auf gut Glück** erstellt direkt einen Entwurf, veröffentlicht ihn aber nicht.
Magic berücksichtigt höchstens acht Räume mit je acht Widgets und nur
die Gerätetypen `CUL_HM`, `MAX`, `LaCrosse`, `Shelly`, `IT`, `MQTT2_DEVICE`,
`MQTT_DEVICE` und `SolaxModbus`. Technische Typen wie `notify` und `at` sowie andere Typen
werden ausgelassen; Räume mit bekannten technischen Namen wie `CUL_HM` ebenfalls.
Homematic-Thermostate werden anhand des zugehörigen steuerbaren Kanals erkannt.
Innerhalb eines Raums werden Thermostate, Schalter und
Messwerttabellen bevorzugt; Wohnzimmer und Küche werden bei der Raumauswahl
bevorzugt. Mehrere Messwerte eines Geräts werden zu einer Tabelle
zusammengefasst; gleichartige einzelne Temperaturanzeigen können ebenfalls
in einer Tabelle stehen. Für Temperatur-Readings, die nachweislich in DbLog
oder FileLog protokolliert werden, ergänzt der Assistent ein Verlaufsdiagramm;
bei `auto` wird DbLog bevorzugt. Ohne geloggtes Temperatur-Reading wird kein
Diagramm erzeugt. Schalter können zusätzlich Messwerte anzeigen.
Temperaturvorschläge benötigen einen gültigen numerischen Istwert.
**Neu auf dev:** Unter dem Spinner zeigt eine gepunktete Linie den Fortschritt
beim Laden, Prüfen, Planen, Anordnen und Speichern. Zur DbLog-Prüfung wird
kein Jahresverlauf mehr geladen: Die vorhandenen gespeicherten Readings
reichen als Nachweis, auch bei älteren Daten. Echte Abfragefehler werden
weiterhin angezeigt und verhindern die automatische Erstellung.
Schalter und Thermostate können in der Ansicht Geräte steuern.
Für SolaxModbus nutzt SolarFlow die PV-Gesamtleistung und gegebenenfalls Batterie-
Readings; ein nicht eindeutig zuordenbarer Hausverbrauch und Energiefluss werden
nicht geraten. Die Berechnung des Hausverbrauchs kann in der Widget-Konfiguration
bei Bedarf aktiviert werden.
Nach dem Einrichten werden die Widgets automatisch angeordnet; ausgelassene
Geräte lassen sich später im Editor hinzufügen.

- **Datei:** Entwurf veröffentlichen/verwerfen sowie Sicherungen und Wiederherstellung.
- **Bearbeiten:** Seiteneinstellungen (Theme, Widget-Rahmen, Titelausrichtung und Rastergröße)
  sowie Widget hinzufügen (mit Suche) und Widgets automatisch anordnen.
- **Ansicht:** Vorschau (zeigt die Seite ohne Bearbeitungselemente) und Raster anzeigen.

### Theme-Manager und Hintergrundbilder

Unter **Bearbeiten → Seiteneinstellungen**
stehen für das gesamte CMS-Device die Themes **Forest Green**, **Hell**,
**Liquid Glass**, **OLED Black** und **Catppuccin Mocha** zur Auswahl.
OLED Black verwendet ohne eigenes Bild einen schwarzen Hintergrund.
Das bisherige Theme **Dunkel** heißt **Forest Green**; bestehende Einstellungen
bleiben erhalten.
Unabhängig vom Theme kann für jede Seite über den Assetmanager ein eigenes Hintergrundbild
ausgewählt oder entfernt werden. Der Dialog zeigt den aktuellen Namen und Ordnerpfad
aus dem Assetmanager; fehlende Bilder oder Katalogfehler werden dort angezeigt.
Auf der Startseite aktiviert der Schalter
**Bild auf allen Seiten verwenden** das gemeinsame
Bild. Die individuellen Bilder der anderen Seiten bleiben gespeichert und
werden nach dem Ausschalten wieder verwendet. Wird die Seitenreihenfolge
geändert, liefert die neue erste Seite das gemeinsame Bild. Hat sie keines,
erscheint auf allen Seiten der Theme-Hintergrund. Die Einstellungen werden als Entwurf gespeichert und
erst beim Veröffentlichen auf der Homepage sichtbar. Verwendete Hintergrundbilder
sind im Assetmanager gegen Löschen geschützt.
Bei Liquid Glass gelten die Regler **Liquid-Effekt** (Unschärfe und Glanz) und **Transparenz**
für alle Seiten. Die Seitenvorschau im Dialog aktualisiert sich beim Verschieben
und verwendet das wirksame Seitenbild. Erst
**Speichern** übernimmt die Werte in den Entwurf; **Abbrechen** verwirft sie.
Hohe Transparenz kann die Lesbarkeit je nach Hintergrundbild verringern.
Die zusätzliche Smartphone-Quervorschau zeigt die aktuelle Seite und das wirksame
Seitenbild. Änderungen an Darstellung, Hintergrund, Rahmen, Titelausrichtung und
Raster erscheinen dort unmittelbar, ohne sie zu speichern. Ist kein Seitenbild
gesetzt, zeigt auch die Vorschau keines.

Die Geräteauswahl oben rechts im Editiermodus bietet Smartphone- und
Tabletprofile sowie verschiedene Desktopauflösungen. Die Drehfunktion wechselt
zwischen Hoch- und Querformat. Die Vorschau zeigt den responsiven Entwurf,
ohne die gespeicherten Desktoppositionen zu verändern; zum Positionieren und
Skalieren der Widgets zurück in den Editor wechseln.

Unter **Bearbeiten → Widgets automatisch anordnen** rücken die Widgets der
aktuellen Seite kompakt nach oben und links. Ihre bisherige Reihenfolge
(zeilenweise von links nach rechts, dann von oben nach unten) bleibt erhalten.
Leicht vertikal versetzte Nachbarn werden dabei als gemeinsame Zeile erkannt,
wenn sich ihre Höhenbereiche mindestens zur Hälfte des kleineren Bereichs
überdecken. Ein hohes Widget zieht keine getrennten Zeilen zusammen.
Widgetgrößen und Inhalte, die Navigation und alle anderen Seiten bleiben
unverändert. Zugunsten der Reihenfolge können einzelne Lücken bleiben; Widgets
werden nicht beliebig vertauscht. Die Anordnung wird sofort als Entwurf
gespeichert, nicht veröffentlicht. Ein vorhandener Entwurf wird verwendet;
Live ändert sich erst mit **Entwurf veröffentlichen**. Bereits angeordnete
Seiten und leere Seiten verursachen keinen zusätzlichen Schreibzugriff.

Unter **Bearbeiten → Seiteneinstellungen → Rastergröße** wählen Sie 12, 24, 48,
96 oder 192 Spalten: mehr Spalten erlauben feinere Positionen und Größen. Die Auswahl gilt
für alle Seiten und die gemeinsame Navigation. Bestehende Positionen und Größen
werden proportional in beiden Richtungen umgerechnet. Beim Vergröbern werden
sie gerundet; Überschneidungen werden durch Verschieben nach unten aufgelöst.
Die Umrechnung erfolgt erst mit **Speichern** als Entwurf. **Abbrechen**
verändert weder Live noch den vorhandenen Entwurf. Der Dialog enthält nur
Layout- und Look-&-Feel-Einstellungen, keine Widgetpositionen oder -größen.
Widgets werden ausschließlich direkt im Editiermodus verschoben und skaliert.
Mit der Maus erscheinen die Bearbeitungsknöpfe erst, wenn Sie das jeweilige
Widget überfahren. Eine dezente farbige Hervorhebung zeigt das aktive Widget.
Die Knöpfe werden auch bei Tastaturfokus im Widget sichtbar und bleiben beim
Ziehen eingeblendet. Auf Touchgeräten ohne Hover werden sie dauerhaft angezeigt.
Dies gilt ebenfalls für das Navigationswidget; Ansicht und Vorschau ändern sich
dadurch nicht.
Die Größenänderung erfolgt über die Ecke unten rechts, auch bei der Navigation.
Die Werkzeugknöpfe stehen links neben dieser Griffzone, damit flache Widgets
weiterhin greifbar bleiben. Die optionalen Größen der Navigationspunkte sind
davon unabhängig und können auf automatisch bleiben.
Die Navigation gilt für alle Seiten. Wird sie vergrößert oder verschoben,
weichen kollidierende Widgets auf allen Seiten nach unten aus, einschließlich
dadurch entstehender Folgeüberschneidungen. Navigation und betroffene Seiten
werden gemeinsam als Entwurf gespeichert. Widgetgrößen und Inhalte bleiben
erhalten; Verkleinern zieht Widgets nicht automatisch wieder nach oben.
Reicht das Raster nach unten nicht aus, wird die gesamte Änderung mit einer
Fehlermeldung verworfen; Live bleibt unverändert.
Beim Wechsel zwischen horizontaler und vertikaler Ausrichtung mit **Speichern**
wird die äußere Navigationsgröße automatisch passend zu den aktuellen Punkten
auf Rasterzellen aufgerundet und innerhalb der Seitenbreite platziert.
Danach können Sie sie weiterhin manuell skalieren. Vertikal erscheint das
Burger-Menü erst, wenn die breiteste Schaltfläche oder die gesamte Höhe der
Punkte nicht in das Widget passt. Horizontal muss die ganze Zeile hineinpassen.
Auf breiten Desktopansichten nutzt die Vorschau dieselbe Navigationsposition und -größe
wie der Editor. Auf Touchgeräten und in der Geräte-Vorschau bleibt die mobile
Anordnung auch im Querformat aktiv. Bei höchstens 600 Pixel Inhaltsbreite wird
die Navigation zum Burger-Menü, das über den Widgets liegt und keinen Platz im
Inhaltsfluss belegt; beim Drehen wird die verfügbare Breite neu ausgewertet.
Wird die Navigation auch im schmalen Bearbeitungsfenster zum Burger-Menü,
liegt das Menü über dem Raster; die gespeicherten Widgetpositionen bleiben
für die präzise Bearbeitung erhalten.
Das Raster nutzt die gesamte verfügbare Inhaltsbreite, auch auf großen Monitoren.
Das exakte Bearbeitungsraster bricht nicht um und passt seine Spaltenbreite
an den Arbeitsbereich an, statt rechts Fläche unbenutzbar zu lassen oder
seitliches Scrollen zu verlangen. Kleine Außenabstände und sichere Geräte-
Ränder bleiben erhalten. Zoom und
Fensteränderungen verändern keine gespeicherten Rasterpositionen. Die Vorschau
zeigt dieselbe Anordnung wie die spätere Ansicht.

**Widgettitel ausrichten (alle Seiten)** legt linksbündige, zentrierte oder
rechtsbündige Titel für alle Widgets dieses CMS-Devices fest. Ohne Einstellung
bleiben Titel linksbündig. Die Auswahl wird als Entwurf gespeichert und gilt auch
in der Vorschau; nach dem Veröffentlichen in der Homepage. Dialogüberschriften
und Textformatierungen innerhalb von Text-/HTML-Widgets bleiben unverändert.

### Fenstergröße, Browser-Zoom und Drehen

Homepage, Vorschau und Editor zeigen bei gleicher verfügbarer Inhaltsbreite
auf breiten Desktopansichten dieselben Positionen, Zeilen und Größenverhältnisse. Widgets und
Navigationsschaltflächen wachsen bzw. schrumpfen gemeinsam mit der Fensterbreite.
Wertanzeigen, Schalter, Taster und Statussymbole nutzen ihren Innenraum mit
kleinem Sicherheitsabstand aus. Titel und eventuelle Fehlermeldungen bleiben
separat; lange Werte und Beschriftungen werden kleiner eingepasst statt
abgeschnitten. Schieberegler reichen bis nahe an die seitlichen Ränder.
**Seit Version 1.9.0 (stapetz/fhem-cms#155):**
Das Raster bleibt auch beim Browserzoom über die volle verfügbare Inhaltsbreite
eingepasst. Im Editor behalten Widgets ihre gespeicherten Rasteranteile;
Zoom vergrößert deshalb nicht mehr zwingend die gesamte Kachel. Homepage
und Vorschau können bei geringerer verfügbarer CSS-Breite früher umbrechen;
deren Mindestgrößen für lesbare Inhalte bleiben erhalten. Zoom und Resize
ändern weder gespeicherte Positionen noch Inhalte.

Bis einschließlich 600 Pixel Inhaltsbreite ordnen Homepage und Vorschau die
Widgets automatisch in Leserichtung mit Zeilenumbruch an, auch beim Drehen eines
Smartphones. Im Hochformat nutzen Widgets dabei die gesamte verfügbare Breite;
im kurzen Querformat erhalten sie mindestens 40 Prozent, damit Inhalte lesbar
bleiben. Die Höhe folgt dem gespeicherten Seitenverhältnis, mindestens jedoch
6 rem (bei Standardschrift 96 Pixel). Gespeicherte Rasterpositionen werden
dabei nicht verändert; der Editor bleibt immer beim exakten Raster.
Auf Geräten mit primär grober Zeigereingabe und in der Smartphone-/Tablet-Vorschau
wird das Ansichts-Raster bei Bedarf an die Breite angepasst, damit es auch im
Querformat nicht horizontal scrollt. Auf breiteren Ansichten bleibt dabei die
gespeicherte Anordnung erhalten.

**Seit Version 1.9.0 (stapetz/fhem-cms#141):**
Homepage und Vorschau brechen auch im schmalen Desktopbrowser bis 80 rem
Inhaltsbreite (bei Standardschrift 1280 Pixel) in Leserichtung um, statt Teile
des Rasters horizontal abzuschneiden. Oberhalb dieser Grenze bleibt das exakte
Desktop-Raster erhalten; das Bearbeitungsraster bleibt bei jeder Breite unverändert.
Im kurzen mobilen Querformat füllen Kacheln den restlichen Platz ihrer Zeile:
Zwei kleinere Kacheln nutzen gemeinsam die Breite, eine alleinstehende
Diagrammkachel die ganze Zeile. Phone-Hochformat und Tablet-Hoch-/Querformat
behalten ihre bisherigen Regeln.
Auf Geräten mit Kamera-Aussparung wird die volle Bildschirmfläche angefordert;
Inhalte bleiben innerhalb der sicheren Ränder. Sicherheitsabstand und normaler
Seitenabstand werden nicht addiert. Die Geräte-Vorschau simuliert keine
Hardware-Aussparung; diese Ränder müssen auf dem echten Gerät geprüft werden.

Die Navigation bleibt auf dem Desktop an ihrer Rasterposition und steht nur
in der schmalen Ansicht vor den Widgets. Auch ihre konfigurierten Buttonbreiten
und -höhen skalieren mit; Pixelangaben beziehen sich auf 1200 Pixel Inhaltsbreite
bei Standardschrift. Passen alle sichtbaren
Menüeinträge einschließlich Abständen in ihre verfügbare Breite, bleiben sie
direkt sichtbar. Ist bei horizontaler Navigation nur die Höhe knapp, werden die
Einträge um höchstens 20 Prozent verkleinert. Reicht Breite oder Höhe auch dann
nicht, erscheint das aufklappbare ☰-Menü. Die Platzprüfung
reagiert auf Drehen, Größenänderungen, Beschriftungen und geladene Schriften.
Widgets folgen ihrer ursprünglichen Zeilen-/Spaltenreihenfolge.
Die Anordnung ist unabhängig von der gewählten Rasterdichte.
Beim Drehen oder Vergrößern bleiben Inhalte und Live-Daten bestehen; es werden
keine Positionen gespeichert. Im Editor selbst bleibt das präzise Raster aktiv.
Zum Prüfen der Umbrüche dort die Geräte-Vorschau verwenden.

Die mobile Ansicht funktioniert auch beim Start über ein iPhone-Homescreen-Icon.
Nach dem Drehen bleiben die Kachelabstände erhalten; das Navigationsmenü wird
anhand des tatsächlich verfügbaren Platzes erneut geprüft.

### Anrufliste für FB_CALLLIST

Im Schema-5-Editor unter **Widget hinzufügen → Anrufliste** ein
`FB_CALLLIST`-Device auswählen. Standardmäßig erscheinen fünf Anrufe mit Status,
Name oder Nummer, Datum/Uhrzeit und Dauer. Die Anzahl ist von 1 bis 20
einstellbar; die sichtbaren Spalten können im Widgetdialog gewählt werden.
Die Reihenfolge der Anrufe übernimmt das Widget vom Device.
Gibt es genau ein `FB_CALLLIST`-Device, ist es beim Anlegen vorausgewählt;
bei mehreren wählen Sie das gewünschte Device. Die Anfangshöhe richtet sich nach
der gewählten Anzahl. Spätere Änderungen der Anzahl verändern die Widgetgröße
nicht automatisch; diese können Sie im Rastereditor anpassen.

Am `FB_CALLLIST`-Device muss `create-readings` auf `1` stehen. Das Attribut
`visible-columns` muss die benötigten Felder enthalten, und `number-of-calls`
begrenzt die vom Device bereitgestellte Anzahl. Das Widget erzeugt keine
zusätzlichen Readings und ändert keine Device-Attribute. Fehlende Spalten
werden kenntlich gemacht; eine leere Anrufliste wird von fehlenden Readings unterschieden.
Unbekannte Status erscheinen neutral. Ein fehlgeschlagener ausgehender Anruf
ist anhand dieser Readings nicht zuverlässig als „besetzt“ unterscheidbar.
Anrufdaten sind persönlich: Zugriff auf CMS und FHEMWEB entsprechend schützen.

### LinkWidget: Seiten- und Bildlinks

Im Schema-5-Editor unter **Widget hinzufügen → LinkWidget** anlegen.
Das Widget kann 1 bis 200 Linkkacheln enthalten. Ein neuer Link verweist zunächst
auf eine vorhandene CMS-Seite; im Dialog wählen Sie das gewünschte Ziel:

- **Interne CMS-Seite:** Auswahl aus den vorhandenen Seiten. Öffnet immer im
  gleichen Fenster/Tab und erhält den aktuellen Ansichtsmodus.
- **Externe Webseite:** Vollständige `http://`- oder `https://`-Adresse.
  Wahlweise gleiches Fenster, neuer Tab oder neues Browserfenster.
  Ein separates Fenster wird vom Browser angefordert; Browser- und Popupregeln
  können daraus einen Tab machen oder das Öffnen verhindern.
  Zugangsdaten in der Adresse und andere Protokolle sind nicht erlaubt.
- **Dokument aus Assetmanager:** Ein abgelegtes Dokument auswählen.
  Es wird über einen Download-Link angeboten.

**Seit Version 1.9.0:** Für interne
Linkkacheln lässt sich unter **Öffnen als** statt Seitenwechsel **Popup (Modal)**
mit kleiner, mittlerer oder großer Breite wählen. Die Zielseite erscheint über
der unveränderten aktuellen Seite und wird mit Live-Daten versorgt. Schließen
über **×**, Escape oder einen Klick außerhalb. Ein weiteres Popup innerhalb
eines geöffneten Popups ist nicht möglich und wird mit einer Meldung abgewiesen.
Die Einstellung wird wie andere Widgetänderungen erst als Entwurf gespeichert.
Bestehende Links behalten den Seitenwechsel. Für ein Zurücksetzen auf einen
älteren Programmstand müssen dazu passende Code- und Konfigurationssicherungen
gemeinsam wiederhergestellt werden.

Jede Kachel benötigt einen **Linktext**, der auch bei ausgeblendetem Text als
zugängliche Linkbeschriftung erhalten bleibt. Mit **Linktext anzeigen** lässt er
sich ein-/ausblenden. Bei sichtbarem Text sind **Oberhalb des Bildes**, **Im Bild**
und **Unterhalb des Bildes** möglich. **Bild hinzufügen …** öffnet den gemeinsamen
Assetmanager für Auswahl und Upload. **Bild entfernen** entfernt nur den Verweis
aus dieser Kachel, nicht die Datei. Uploads bleiben auch nach Abbrechen des
Widgetdialogs im Assetmanager erhalten.

Im **Konfigurationsdialog** eine Kachel über ihren Griff verschieben und unten
rechts skalieren. Das innere Raster hat unabhängig vom Seitenraster 12 Spalten
und höchstens 1000 Zeilen; bei vielen Kacheln scrollt der Rasterbereich.
Über die Beschriftung der Kachel wählen Sie deren Einstellungen aus.
Ein feines Raster bleibt während der Kachelbearbeitung dauerhaft sichtbar.
Position und Größe werden ausschließlich grafisch geändert.
Überlappungen sind nicht speicherbar. Das äußere LinkWidget verschieben und
skalieren Sie weiterhin wie andere Widgets auf der CMS-Seite.

**Seit Version 1.9.0:** Beim Speichern
passt sich die äußere Widgetgröße an die belegte Fläche der Linkkacheln an.
Bei einem neuen Widget benötigt ein einzelner Link mit 4 × 3 inneren Rasterfeldern bei 12 Seitenspalten
4 × 3 äußere Felder; ein sichtbarer Widgettitel ergänzt eine Zeile.
Feinere Seitendichten skalieren diese Außenmaße entsprechend.
Bei bestehenden Widgets bleibt der bisherige Maßstab für Breite und Höhe
erhalten, auch nach manueller Größenänderung auf der Seite. Unveränderte
Linkflächen ändern daher die Außenmaße nicht. Größere oder kleinere belegte
Linkflächen passen die Außenmaße proportional an, auf ganze Rasterfelder gerundet.
Ein volles inneres 12-Spalten-Raster bedeutet nicht volle Seitenbreite.
Leere Randzeilen und -spalten werden in der Anzeige nicht mitgezählt;
Abstände zwischen den Kacheln bleiben erhalten. Die Außenposition bleibt
unverändert. Braucht das LinkWidget mehr Platz, erscheint beim Speichern eine
**Vorher-/Nachher-Vorschau** der Seite mit markierten und benannten Widgets,
die dafür nach unten rücken müssen. Noch wird nichts gespeichert.
Erst **Platz schaffen und speichern** übernimmt das gewachsene LinkWidget und
die angezeigten Verschiebungen gemeinsam in den Entwurf. Die anderen Widgets
behalten Inhalte, Breite, Höhe und horizontale Position; Navigation und andere
Seiten bleiben unverändert. Auch notwendige Folgeverschiebungen werden gezeigt.
**Zurück zur Linkbearbeitung** erhält alle Eingaben, Bilder und die Anordnung.
**Abbrechen** verwirft die Dialogänderungen ohne Schreibzugriff.
Bei zu wenig Platz am rechten/unteren Seitenrand oder einer Kollision mit der
Navigation ist kein automatisches Platzschaffen möglich: Der Dialog bleibt mit
einer Meldung offen. Dann Kacheln verkleinern oder das äußere Widget verschieben.
Ausgewählte Bilder erscheinen sofort auch auf den Kacheln im Bearbeitungsraster.
Das Entfernen eines Bildes löscht dort ebenfalls die Vorschau.

**Speichern** übernimmt Links und innere Positionen gemeinsam in den Entwurf
(bei nötigen Nachbarverschiebungen erst nach der zusätzlichen Bestätigung);
**Abbrechen** verwirft diese Dialogänderungen. Die Homepage ändert sich erst mit
**Veröffentlichen**. Interne Links werden beim Umbenennen einer Seitendatei
automatisch mitgeführt. Vor dem Löschen einer verlinkten Seite müssen die
betroffenen Links geändert oder entfernt werden.

### Assetmanager: Bilder und Dokumente

Über **Datei → Assetmanager** verwalten Sie die Assets des aktuellen CMS-Devices.
Denselben Dialog öffnen **Bild hinzufügen …** im Texteditor und LinkWidget sowie
**Dokument auswählen …** bei Dokumentlinks. Die Bildauswahl zeigt nur Bilder,
die Dokumentauswahl nur Dokumente. Bereits früher im Textwidget hochgeladene
Bilder stehen automatisch im gemeinsamen Stammordner zur Verfügung.

- In der großen Übersicht auf eine **Ordnerkachel** klicken. Ein Klick öffnet den
  Ordner; er verändert oder löscht keine Dateien. Es gibt keine linke
  Baumstruktur und keinen getrennten Bereich „Ordner verwalten“.
  Die Übersicht zeigt dessen direkte Unterordner und Dateien. Der **Stammordner**
  zeigt ebenfalls nur seine eigenen Inhalte, nicht zusätzlich alle Unterordner.
  Über den klickbaren Pfad oberhalb zur übergeordneten Ebene zurückkehren.
  **Ordner erstellen** oberhalb der Übersicht öffnet die Namenseingabe und legt
  den neuen Ordner im aktuell geöffneten Ordner an. Die Ansicht bleibt im
  bisherigen Ordner, sodass die neue Kachel direkt sichtbar ist.
  Zum Umbenennen, Verschieben oder Löschen **⋯** an der jeweiligen Ordnerkachel
  wählen. Die Eigenschaften erscheinen dann bei Bedarf rechts. Nur leere Ordner
  lassen sich löschen, nach einer zusätzlichen Bestätigung mit vollständigem Pfad.
  Auch die Zielordnerauswahl verwendet ausschließlich Kacheln und Pfad.
- Unter **Dateien in diesen Ordner hochladen** eine oder mehrere Dateien wählen.
  Alternativ eine oder mehrere Bild-/Dokumentdateien vom Rechner direkt in die
  große Ordneransicht ziehen (**Drag-and-drop**). Die Ablagefläche wird beim
  Darüberziehen hervorgehoben. Ganze Ordner werden nicht importiert.
  Alle Dateien eines Auftrags landen direkt im aktuell geöffneten Ordner.
  Die Übersicht bleibt dort; Dateidetails mit Umbenennen/Verschieben werden
  nach dem Upload nicht automatisch geöffnet. Erst der Klick auf eine Datei
  öffnet deren Eigenschaften.
  Fortschritt und Fehler werden mit der Anzahl abgeschlossener Dateien
  angezeigt. **Upload abbrechen** verwirft den laufenden Upload und startet
  die übrigen Dateien nicht; bereits abgeschlossene Uploads bleiben erhalten.
  Dasselbe gilt beim ersten Fehler eines Auftrags.
  Identische Dateien werden wiederverwendet, nicht dupliziert; eine vorhandene
  Datei bleibt dabei in ihrem bisherigen Ordner.
- Die Suche ist vorerst nicht verfügbar. Eine verlässliche Suchfunktion ist als
  spätere Erweiterung in [Issue #126](https://github.com/stapetz/fhem-cms/issues/126)
  vorgemerkt. Zur Navigation Ordnerkacheln und Pfad verwenden.
- Ein Asset anklicken: Dateinamen ändern (ohne Wechsel der Endung),
  herunterladen oder Verwendungen anzeigen. Der **Dateiname** ist ohne
  Endung editierbar, die unveränderbare Endung steht daneben.
  **Umbenennen** direkt darunter speichert nur den Namen.
  **Verschieben** öffnet die grafische Zielauswahl: Zum Ziel navigieren und
  **Diesen Ordner verwenden** wählen. Diese Bestätigung führt das Verschieben
  sofort aus; ein weiterer Speichern-Knopf ist nicht notwendig. Nicht gespeicherte
  Änderungen im Namensfeld werden dabei nicht übernommen. Der Manager zeigt
  das Asset anschließend im Zielordner und bestätigt den Speicherort.
  Abbrechen der Zielauswahl verschiebt nichts. Verschieben/Umbenennen ändert
  gespeicherte Bild-/Dokumentadressen nicht.
- Ausgewählte Bilder werden rechts als **Bildvorschau** angezeigt. Beim
  Darüberfahren steht **Bild in voller Größe anschauen**; Klick öffnet das
  Original in einem neuen Tab. Vorhandene EXIF-Daten in JPEG-/PNG-Bildern werden
  lokal im Browser ausgelesen. **i** auf der Vorschau öffnet die Informationen
  (z. B. Kamera, Aufnahmedatum, Belichtung und gegebenenfalls GPS-Standort).
  Es werden keine Metadaten an externe Dienste übertragen. Ohne EXIF erscheint
  kein i; Lesefehler werden ausdrücklich angezeigt. Herstellerspezifische
  Binärfelder erscheinen als Rohwerte, lange Werte gekürzt und unbekannte Tags
  mit ihrer Nummer. Die Originaldatei wird nicht verändert oder bereinigt.
- **Seit Version 1.9.0:** Bei einem Bild
  stehen rechts das Original und seine Varianten mit Dateigröße und Bildmaßen
  (Breite × Höhe in Pixeln) zur Auswahl. Der Detailkopf zeigt dieselben Angaben
  für das ausgewählte Bild; die Maße werden aus der geladenen Vorschau gelesen.
  **Schließen** und gegebenenfalls **Auswählen** stehen über der eingeklappten
  Administration. Dort liegt **Neu laden** für Änderungen aus anderen Fenstern
  oder einen erneuten Ladeversuch nach einem Verbindungsfehler; eigene Änderungen
  erscheinen automatisch.
  **Bild bearbeiten** zeigt die Auflösung des Quellbildes. Die Ausschnittgröße
  wird in Quellpixeln angezeigt; die Ausgabegröße ist die
  finale Auflösung der neuen Variante nach Zuschnitt und möglicher Verkleinerung.
  Sie entspricht zunächst dem Ausschnitt und kann nicht größer als dieser sein.
  Das Crop-Symbol über dem Bild aktiviert die Auswahl per Maus oder Touch.
  Den Rahmen innen ziehen, um ihn zu verschieben; die acht Rand- und Eckgriffe
  verkleinern oder vergrößern ihn. Außerhalb des Rahmens lässt sich ein neuer
  Ausschnitt aufziehen. Numerische Zuschnittsfelder gibt es nicht.
  Rahmen und Griffe sind auch per Pfeiltasten bedienbar (mit Umschalt: 10 Pixel).
  Die kompakte Option **Seitenverhältnis beibehalten** erscheint beim aktiven
  Zuschneidewerkzeug neben OK/Abbrechen und hält das Verhältnis der
  aktuellen Auswahl fest. Die getrennte, zunächst aktivierte Option bei der
  Ausgabegröße führt beim Ändern von Breite oder Höhe die andere Dimension
  passend zum Ausschnitt nach; ohne Haken sind beide Werte frei wählbar.
  Zum reinen Verkleinern muss das Zuschneidewerkzeug nicht aktiviert werden.
  **OK** bestätigt den Ausschnitt, **Abbrechen** verwirft ihn. Erst
  **Variante erstellen** lädt das Ergebnis als neue Variante hoch; das Original
  bleibt unverändert. PNG und JPEG bleiben in ihrem
  Format, ein einzelnes GIF-Bild wird als PNG gespeichert; Bildmetadaten werden
  nicht in die Variante übernommen. Animierte GIFs und APNGs werden abgewiesen.
  Bearbeitung ist auf 8192 Pixel je Seite und 16 Megapixel begrenzt; die
  konfigurierten Uploadlimits und erlaubten Dateitypen gelten auch für Varianten.
  Varianten lassen sich einzeln auswählen und löschen. Beim Verschieben folgt
  die Gruppe dem Original. Wird das Original gelöscht, bleiben seine Varianten
  als eigenständige Bilder erhalten. Für jede Datei gilt der Verwendungs- und
  Löschschutz einzeln. Für einen Rollback ältere Programmstände nur gemeinsam
  mit einer passenden gesicherten Version des Assetkatalogs und der Dateien
  verwenden.
- **Löschen** öffnet einen Bestätigungsdialog mit dem Dateinamen; der bisherige
  dauerhafte Bestätigungshaken entfällt. Verwendete
  Assets sind unabhängig davon gesperrt: Die Warnung nennt **Live/Entwurf,
  Seite und Widget**. Zuerst diese Verweise entfernen; die Verwendung wird beim
  Löschen serverseitig erneut geprüft.
  **Verwendungen anzeigen** öffnet dafür ein eigenes Popup, ebenso die
  Verwendungswarnung bei gesperrter Löschung. Ohne Verweise steht dies
  ausdrücklich im Popup. **Schließen** steht wie bei EXIF rechts.
  Löschdialoge zeigen **Abbrechen** und **Löschen** ebenfalls rechts,
  beide als normale Standardbuttons.

Dateinamen im Assetmanager sind Anzeigenamen. Die Dateien behalten ihre
Hash-Dateinamen im Dateisystem; Umbenennen verändert keine eingebundenen
Bildadressen. Eine Umstellung auf echte Dateinamen ist nicht vorgesehen.

Assetänderungen gelten **sofort**, nicht erst nach Veröffentlichen des
Seitenentwurfs. Entfernen eines Bildes/Links aus einem Widget löscht niemals das
Asset. Umgekehrt ist eine bestätigte Assetlöschung unwiderruflich. Ältere
Konfigurationssicherungen enthalten keine Assetdateien und können auf danach
gelöschte Dateien verweisen. Assets deshalb separat mit sichern.
Die Verwendungsprüfung umfasst die gespeicherten Live-/Entwurfsseiten dieses
CMS-Devices, nicht externe Verweise oder noch ungespeicherte Dialogänderungen.

Das FHEM-CMS ist bewusst kein klassisches Mehrbenutzer-CMS, sondern ein
leichtgewichtiges Frontend, mit dem sich schnell FHEM-Oberflächen und
redaktionelle Texte erstellen lassen. Deshalb gibt es keine eigenen CMS-Konten,
Rollen oder persönlichen Entwürfe. Anmeldung und Zugriffsrechte bleiben bei
FHEMWEB. Alle dort berechtigten Bearbeiter arbeiten am selben CMS-Datenbestand;
gleichzeitige Bearbeitungen können zu Konflikten führen. Schütze den Zugriff
deshalb mit den passenden FHEMWEB-Rechten.

Unter **Administration: Dateitypen und Speichergrenzen** gelten die
Administrationsfunktionen für alle berechtigten CMS-Bearbeiter gleich.

| Vorgabe | Standard |
|---|---|
| Bilder | PNG, JPEG, GIF; höchstens 3 MiB je Datei |
| Dokumente | PDF, Word (`doc`, `docx`), Excel (`xls`, `xlsx`), PowerPoint (`ppt`, `pptx`), OpenDocument (`odt`, `ods`, `odp`), TXT und CSV |
| Dokumentgröße | höchstens 20 MiB je Datei |
| Gesamtspeicher | 500 MiB je CMS-Device |

Typen können per Checkbox für neue Uploads gesperrt/freigegeben werden.
Weitere Endungen können ergänzt werden; aktive Web-/Skriptformate wie HTML,
SVG oder JavaScript bleiben gesperrt. Bestehende Dateien eines später gesperrten
Typs bleiben erhalten. Größenlimits lassen sich konfigurieren, mit technischen
Obergrenzen von 50 MiB je Datei und 2048 MiB gesamt. Ein niedrigeres Limit löscht
keine vorhandenen Assets, verhindert aber weitere Uploads, solange es überschritten
ist. Weitere Schutzgrenzen: 2000 Assets, 200 Ordner, höchstens 10 Ordnerebenen.
Der Katalog selbst darf 1 MiB Metadaten enthalten; sehr lange Namen können
diese Grenze vor der maximalen Assetanzahl erreichen.

Dokumente werden außerhalb des Web-Verzeichnisses abgelegt und ausschließlich
als Download ausgeliefert; es gibt keine Office-Vorschau oder Skriptausführung im
CMS. Formatprüfungen sind **kein Virenscanner** – nur vertrauenswürdige Dokumente
öffnen. Größere Uploads und Dokumentdownloads werden in 64-KiB-Blöcken übertragen,
damit FHEM zwischen den Blöcken weiterarbeiten kann. Ein Upload läuft höchstens
15 Minuten; je Device ist ein gleichzeitiger Upload möglich.
Bei parallelen Katalogänderungen erscheint eine Konfliktmeldung: **Neu laden**
und die gewünschte Aktion erneut ausführen.

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

Entwicklungsstand `dev`: Mit **Seite duplizieren** in der Seitenverwaltung
entsteht eine Kopie mit eigener Seiten-ID, Widgets und Layout. Sie wird erst
mit **Speichern** im Entwurf angelegt; die Live-Seite bleibt unverändert.

Entwicklungsstand `dev`: Das X am Widget entfernt es nach einer Bestätigung
direkt aus dem Entwurf. Die veröffentlichte Seite bleibt bis zur Veröffentlichung
des Entwurfs unverändert.

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
  - *Hinweis:* DbLog- und FileLog-Verläufe werden im Hintergrund abgefragt, damit FHEM währenddessen bedienbar bleibt. Die Abfragen haben ein Zeitlimit; bei großen Datenmengen kann ein Verlauf daher mit einem Fehler enden.
- **Tabelle:** `Einfügen → Tabelle` zeigt Readings in einer laufend aktualisierten Tabelle. Im Dialog wählen Sie zuerst, ob die Werte aus einem Device (Standard) oder aus mehreren Devices kommen: Bei einem Device wählen Sie es einmal und danach je Zeile nur noch das Reading; bei mehreren Devices wählen Sie je Zeile Device und Reading. Beim Umschalten bleiben die Zeilen erhalten. Optional blendet eine Summenzeile unter der Tabelle die Summe der numerischen Einzelwerte ein (Beschriftung Standard „Summe“, änderbar); die Einheit ist wählbar oder „Automatisch“ (nur wenn alle summierten Werte dieselbe haben); die Beschriftung kann auch ausgeblendet werden, dann steht nur der Wert da. Die Tabellenüberschrift lässt sich ganz ausblenden; die Überschrift der Wertespalte (Standard „Wert“, rechtsbündig) ist änderbar oder einzeln ausblendbar. Die Überschrift der Geräte-/Bezeichnungsspalte ist anpassbar; Readings bleiben intern und werden nicht als eigene Spalte angezeigt. Für jeden Wert können gängige Einheiten wie °C, km, m, %, W oder kWh sowie eine eigene Einheit gewählt werden. Als Name einer Zeile erscheint der FHEM-Alias, sonst der Device-Name; im Feld „Bezeichner“ lässt sich ein eigener Name vergeben.
- **Freies HTML:** Menü `Einfügen` → `Freies HTML`. Im Dialog tragen Sie eigenen HTML-Code ein und setzen Werte aus FHEM mit Platzhaltern ein, z. B. `{{Wohnzimmer:temperature|round(1)}}`; die Anzeige aktualisiert sich live. Alternativ im FTUI-Stil: `<span device="Wohnzimmer" reading="temperature"></span>`. Mit `data-cms-class` ändern sich Klassen (Farben) je nach Zustand. Skripte, Bilder, Formulare und Ereignis-Attribute sind aus Sicherheitsgründen nicht erlaubt. Die Platzhalter-Hilfe steht im Dialog; ausführlich in [PLATZHALTER.md](PLATZHALTER.md).
- **Taster:** Menü *Einfügen* → *Taster* (im Schema-5-Editor **Bearbeiten → Widget hinzufügen**). Device wählen und einen Befehl ohne Parameter (z. B. `toggle`, `on`, `up`) festlegen. Standardmäßig erscheint ein Symbol statt des Befehlstexts: Umschaltpfeile für `toggle`, An-/Aus-Symbol für `on`/`off`, sonst ein Tastensymbol. Unter **Darstellung** wählen Sie **Nur Symbol** oder **Symbol + Beschriftung**. Die optionale Beschriftung ersetzt den Befehlstext. Ein Klick in der Ansicht sendet unverändert den Befehl; im Bearbeitungsmodus wird nichts gesendet.
- **Schalter:** Menü *Einfügen* → *Schalter* (im Schema-5-Editor **Bearbeiten → Widget hinzufügen**). Device, Zustandsreading (meist `state`) und die Befehle für „An“ und „Aus“ wählen. Das Symbol selbst ist die Schaltfläche, ohne zusätzlichen Schieber; An, Aus und unbekannter Zustand sind unterscheidbar. Unter **Darstellung** können Sie zusätzlich Text einblenden (Standard An/Aus/Zustand unbekannt, eigene Beschriftung möglich). In der Ansicht schaltet ein Klick; im Bearbeitungsmodus wird nicht geschaltet.
- **Gemeinsame Symboldarstellung:** Auch vorhandene Schalter und Taster verwenden ohne explizite Einstellung **Nur Symbol**; gespeicherte Beschriftungen gehen nicht verloren und lassen sich wieder zuschalten. Widgettitel bleiben unabhängig davon sichtbar bzw. separat ausblendbar. **Icon wählen …** überschreibt das eingebaute Standardsymbol mit einem eigenen Icon. Im Icon-Picker setzt **Standardsymbol** bzw. **Standardsymbol / Vererbung** die Auswahl zurück. Beim Schalter gilt ein eigenes An-Icon auch für Aus, solange kein eigenes Aus-Icon gewählt wurde; ohne eigene Icons gelten die eingebauten Zustandssymbole. Standardsymbole benötigen keine nachinstallierten FHEM-Iconpakete.
- **Platzhalter suchen:** Im freien HTML (Knopf *Platzhalter suchen und einfügen …*) und im Textbaustein (Knopf `{{ }}`) suchen Sie ein Device und ein Reading und fügen den Wert ein; im Textbaustein lässt sich der Platzhalter per Klick nachträglich ändern und wie normaler Text formatieren (fett, kursiv, unterstrichen, durchgestrichen, Farbe, Hervorhebung). Details in [PLATZHALTER.md](PLATZHALTER.md).
- **Textbaustein:** WYSIWYG-Editor mit Fett, Kursiv, Unterstrichen, Durchgestrichen, Überschriften, Listen, Ausrichtung, Links, Tabellen und Bildern. Markieren Sie den gewünschten Text und wählen Sie die Formatierung; auch in Safari bleibt die markierte Stelle beim Bedienen der Werkzeugleiste erhalten. Für Textfarbe oder Hervorhebung wählen Sie unter **Farbe** den Farbwert und anschließend **Anwenden**. Bilder (PNG, JPEG, GIF, höchstens 3 MiB) werden hochgeladen oder aus bereits vorhandenen gewählt; ein Klick auf das Bild öffnet Position (links, Mitte, rechts, voll) und Alternativtext. Die Größe ändern Sie am grünen Ziehpunkt unten rechts am Bild: ziehen (das Seitenverhältnis bleibt erhalten, feinste Auflösung 1 % der Textbreite) oder den Ziehpunkt fokussieren und die Pfeiltasten nutzen. Der Text wird beim Einfügen und Speichern bereinigt, Skripte und fremde Bildquellen sind nicht möglich. Alte Markdown-Bausteine werden beim Bearbeiten umgewandelt.
- **Zwei Einstiege am Device:** Beide Links öffnen ein neues Browserfenster. „CMS starten“ öffnet den Bearbeitungsmodus (`?mode=edit`). „Zeige Homepage“ öffnet die Seite ohne Parameter (Standard), also nur die fertige Seite ohne Kopf, Werkzeugleiste und Zahnräder. Die Seitennavigation und die Kachelwerte bleiben. Achtung: Das ist nur eine Ansicht und keine Zugriffssperre, wer `?mode=edit` an die Adresse hängt, kann bearbeiten. Schutz bieten nur `allowed` und FHEMWEB.
- **Vorschau:** Öffnet in einem neuen Fenster den aktuellen Entwurf so, wie die Seite nach dem Veröffentlichen ausgeliefert würde (ohne Bearbeitungsknöpfe). Der Entwurf wird bei jeder Änderung gespeichert, ein Neuladen des Vorschaufensters zeigt den neuesten Stand.
- **Kacheln verschieben und skalieren:** Im Bearbeitungsmodus ist das immer möglich (kein eigener Modus). Jede Kachel hat oben rechts nebeneinander die Symbole ⇄ („Widget auf andere Seite verschieben“), ⠿ („Widget auf dieser Seite verschieben“, Griff) und ⚙ („Widget konfigurieren“); Ziehen mit Maus oder Touch, oder Griff fokussieren und Pfeiltasten nutzen. Die Größe ändern Sie am Griff unten rechts der Kachel, der beim Darüberfahren erscheint (ziehen) oder mit Umschalt+Pfeiltasten am fokussierten Kachel-Griff. Position und Größe rasten im gewählten Raster ein (12, 24 oder 48 Spalten, siehe „Seite einrichten“). Was mit anderen Kacheln passiert, hängt von der Positionierung ab: Im Raster rutschen überlappende Kacheln nach unten, bei Fluss und Spalten ordnen sich alle neu an, bei Frei bleiben sie unberührt. Verdrängte Kacheln gleiten an ihren neuen Platz. Das Layout wird gespeichert. Der Konfigurationsdialog der Kacheln enthält keine Rasterfelder mehr. Der Knopf ⇄ oben rechts an jeder Kachel verschiebt sie auf eine andere Seite (unten angehängt, Konfiguration bleibt erhalten); das gilt für alle Widget-Typen. Auf schmalen Bildschirmen ist der Modus ausgeblendet.
- **Farbschema:** Im Bearbeitungsmodus unter „Datei › Seite einrichten …“ das Theme Forest Green oder Hell wählen. Die Auswahl gilt für das gesamte CMS-Device und wird mit dem Entwurf erst nach „Veröffentlichen“ auf der Homepage sichtbar.
- **Geräte-Vorschau:** Auch im Schema-5-Bearbeitungsmodus wählen Sie oben rechts ein Gerät (iPhone, iPad, Android oder Desktop-Auflösung). Der Entwurf erscheint in einem Rahmen mit der echten Bildschirmgröße und wird bei Bedarf verkleinert, damit er ins Fenster passt. Die Seite reagiert wie auf dem Gerät. Mit ⟳ wechseln Sie zwischen Hoch- und Querformat; „Vorschau: Aus“ oder Esc schließt die Ansicht.
- **Seite einrichten:** `Datei › Seite einrichten …` öffnet einen Dialog mit seitenübergreifenden Einstellungen: **Theme** (Forest Green/Hell; ersetzt die früheren Einträge im Menü „Ansicht“) und **Rahmen am Widget anzeigen** (ja/nein). Dazu kommt die **Positionierung** (mit Vorschau je Modus): **Raster** (feste Zellen, Überlappendes rutscht nach unten), **Fluss** (Reihenfolge links nach rechts mit automatischem Umbruch), **Spalten/Masonry** (lückenlos von oben nach unten) und **Frei** (beliebig platzieren, Überlappung erlaubt). Die **Rastergröße** (12/24/48 Spalten) bestimmt die Schrittweite beim Verschieben und Skalieren; bei „Frei“ gilt immer 48. Beim Wechsel werden alle Seiten umgerechnet, die Positionen bleiben im 48er-Raster gespeichert. Die Einstellungen gelten für alle Seiten und werden im Entwurf gespeichert (`theme`, `settings.showFrames`, `settings.layoutMode` = `grid`/`flow`/`masonry`/`free`, `settings.gridColumns` = 12/24/48).
- **Werkzeugleiste und Meldungen:** Die Leiste ist eine Menüleiste wie in klassischen Programmen mit den Menüs **Datei** (Seite einrichten …, Vorschau, Veröffentlichen, Entwurf verwerfen, Backups …, Daten löschen …), **Bearbeiten** (Navigation bearbeiten …), **Einfügen** (Thermostat-Kachel, Wert-Anzeige, Schalter, Taster, Freies HTML, Uhr / Datum, Status-Symbol, Tabelle, Schieberegler, Diagramm, SolarFlow, Textbaustein) und **Ansicht** (Raster anzeigen, mit Häkchen) (sie schwebt oben links in Blau über der Seite, auf gleicher Höhe wie die Geräte-Auswahl rechts, und gehört nicht zum Inhaltsraster; Kacheln lassen sich bis ganz nach oben schieben). Meldungen (z. B. „Layout gespeichert“, Hinweis auf einen unveröffentlichten Entwurf) erscheinen als rotes Ausrufezeichen oben rechts; ein Klick darauf öffnet eine kleine Box mit den Meldungen (Klick daneben oder Esc schließt sie). Im Ansichtsmodus erscheinen nur akute Fehler.
- **Raster anzeigen:** Im Menü Ansicht blendet „Raster anzeigen“ das Raster des Seiteninhalts als Gitterlinien ein oder aus (wird im Browser gemerkt). Es erscheint nur im Bearbeitungsmodus und folgt der gewählten Rastergröße.
- **Wiederherstellen per Modul:** `set <CMS> restore` bietet die 20 neuesten Backups als Auswahlliste an.
- **Entwurf und Veröffentlichen:** Änderungen im Bearbeitungsmodus landen in einem Entwurf. „Zeige Homepage“ zeigt weiter den bisherigen Live-Stand. `Veröffentlichen` übernimmt den Entwurf als Live-Stand, `Entwurf verwerfen` löscht ihn. Es gibt einen gemeinsamen Entwurf pro Device. Speichert ein anderer Bearbeiter zwischenzeitlich, wird ein veralteter Speicherversuch abgelehnt, statt den neueren Stand zu überschreiben. Lade dann den aktuellen Stand neu und übernimm deine Änderungen erneut. Eine Bearbeitungssperre oder Anzeige, wer gerade bearbeitet, gibt es nicht.
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
