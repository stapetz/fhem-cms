# fhem-cms

Frontend zur Erstellung grafischer Oberflächen für FHEM, einschließlich freier Seiten und Inhalte wie in einem klassischen Content-Management-System.

**Aktuelle stabile Version: 1.9.0**

## Neu in 1.9.0

- Interne CMS-Seiten als Popup aus Linkkacheln öffnen, mit drei Größen und
  Livewerten ohne Verlassen der Hauptseite.
- Bilder im Assetmanager zuschneiden, skalieren und als Varianten speichern;
  Originale bleiben erhalten. Dateigröße und Pixelmaße werden angezeigt.
- LinkWidget-Größe passend zu den Linkkacheln; bei Platzmangel zeigt eine
  Vorschau die nötigen Verschiebungen und verlangt eine ausdrückliche Bestätigung.
  Kachelbilder sind bereits im inneren Bearbeitungsraster sichtbar.
- Raster über die gesamte Inhaltsbreite, auch im Editor bei Browserzoom;
  verbesserte mobile Navigation, Hoch-/Querformat und sichere Bildschirmränder.
- Escape schließt die Geräte-Vorschau auch bei Fokus im Vorschauinhalt.
- Das Internal `VERSION` wird auch bei fehlgeschlagener Initialisierung gesetzt.

## Neu in 1.8.0

- Theme-Manager mit Forest Green, Hell, Liquid Glass, OLED Black und Catppuccin
  Mocha; Hintergrundbilder pro Seite oder gemeinsam für alle Seiten.
- Liquid-Effekt und Transparenz einstellen und Änderungen direkt in einer
  Smartphone-Vorschau prüfen.
- Anruflisten-Widget für FB_CALLLIST mit konfigurierbaren Spalten und 1 bis 20
  Anrufen; ein einzelnes passendes Device wird automatisch ausgewählt.
- Smartphone- und Tabletansichten ohne horizontalen Raster-Scrollbar.

## Neu in 1.7.0

- Einrichtungsassistent für neue, leere CMS-Konfigurationen: leer beginnen,
  Räume und Geräte mit Vorschau auswählen oder mit Magic einen Entwurf erstellen.
- Magic berücksichtigt höchstens acht Räume mit je acht Widgets und erkennt
  ausgewählte Geräte, Thermostate, Schalter und Messwerttabellen.
- SolaxModbus kann mit vorhandener PV-Gesamtleistung und optionalen
  Batterie-Readings als SolarFlow vorgeschlagen werden, ohne unbekannte
  Energieflüsse oder den Hausverbrauch zu erraten.
- Aktive Navigationspunkte ändern nur ihren Hintergrund und nicht ihre Breite.

Automatische Temperaturverläufe sind nicht Teil dieses Releases.

## Neu in 1.6.1

- LinkWidget mit mehreren internen oder externen Links, optionalen Bildern
  und Beschriftungen sowie frei platzierbaren Kacheln im feinen Raster.
- Gemeinsamer Assetmanager für Text- und Linkwidget unter **Datei**:
  Bilder und Dokumente in Ordnern verwalten, umbenennen und verschieben.
- Mehrfachupload per Dateiauswahl oder Drag-and-drop direkt in den geöffneten
  Ordner; Bildvorschau und EXIF-Informationen.
- Verwendungsschutz mit Fundstellen in Live und Entwurf; einheitliche
  Informations- und Bestätigungsdialoge.
- Konfigurierbare Dateitypen und Speichergrenzen. Bestehende Bildadressen
  und Hash-Dateinamen bleiben erhalten.
- Einheitliche Titeldarstellung auch im Textwidget.

Die Assetsuche und die vollständige deutsche/englische Gerätehilfe bleiben
separaten Weiterentwicklungen vorbehalten.

## Neu in 1.2.0

- Einheitliche Rasterdarstellung in Editor und Ansicht, besser ausgefüllte
  Widgets und globale Titelausrichtung.
- Zuverlässiger Thermostat-Gerätewechsel, skalierbare Navigation und
  Bearbeitungsknöpfe bei Hover oder Tastaturfokus.
- Automatisches Anordnen der Widgets unter Beibehaltung der Leserichtung.
- Safari-Textformatierung, Einheiten hinter eingefügten Readings und gemeinsame
  Einheitenfelder mit Vorschlägen; SolarFlow hält den Titelbereich frei.
- speziel Fehler von Herrn Professor bzgl kWh Darstellung gefixt

## Repositorystruktur

| Pfad | Zweck |
|---|---|
| `FHEM/` | FHEM-Integration und Moduldateien |
| `docs/` | Dokumentation für Anwender |
| `dev-docs/` | Interne Entwicklungsdokumentation |
| `www/fhem-cms/` | Frontend für FHEM; enthält gemeinsame Assets und Komponenten |
| `controls_fhem-cms.txt` | Vom Workflow erzeugte Update-Liste für alle installierbaren Dateien dieses Repositories |
| `CHANGED` | FHEM-Änderungsprotokoll für Updates |

Die wiederverwendbaren Web Components liegen unter `www/fhem-cms/components/`; die gemeinsamen Styles und der Modul-Einstieg liegen unter `css/` und `js/`.

Die Update-Historie wird aus den JSON-Dateien unter `release-notes/` und dem
unveränderten historischen Archiv erzeugt: `python3 scripts/generate_changed.py`.
Der Update-Workflow aktualisiert `CHANGED` automatisch. Die neueste
Zusammenfassung steht ohne Leerzeilen am Anfang, damit FHEM sie beim Update
ausgeben kann. `CHANGED` wird nicht als installierbare Datei geführt und
überschreibt nicht die gleichnamige FHEM-Datei.

## Version

Die aktuelle stabile Version ist **1.9.0**. Die installierte Version steht im Internal `VERSION` des FHEMCMS-Devices (`list <gerät>`), auch wenn die anschließende Initialisierung fehlschlägt. Die Angabe allein bestätigt keine erfolgreiche Initialisierung. Entwicklungsstände auf `dev` tragen den Suffix `-dev`; die stabile Versionsnummer wird für jeden freigegebenen `main`-Release nach SemVer erhöht.

## Installation und Update in FHEM

fhem-cms wird als **ein gemeinsames Repository** aktualisiert. Die zentrale Controls-Datei umfasst das FHEM-Modul und alle dazugehörigen Frontend-Dateien. Es gibt keine getrennten Update-Quellen für einzelne Module oder Komponenten.

Für den freigegebenen Stand:

```text
update add https://raw.githubusercontent.com/stapetz/fhem-cms/main/controls_fhem-cms.txt
update all https://raw.githubusercontent.com/stapetz/fhem-cms/main/controls_fhem-cms.txt
shutdown restart
```

Entwickler können stattdessen den Entwicklungsstand von `dev` verwenden:

```text
update add https://raw.githubusercontent.com/stapetz/fhem-cms/dev/controls_fhem-cms.txt
update all https://raw.githubusercontent.com/stapetz/fhem-cms/dev/controls_fhem-cms.txt
shutdown restart
```

Nach dem Update steht das Modul `FHEMCMS` zur Verfügung. Ein Testgerät lässt sich beispielsweise mit `define CMS fhemcms` anlegen. Der Gerätetyp wird unabhängig von Groß-/Kleinschreibung erkannt. Neue Devices werden standardmäßig dem Raum `FHEM CMS` zugeordnet; in der FHEM-Raumansicht erscheint ein Link `CMS starten`, der direkt die Device-Startseite öffnet. Die Startseite und ihr URL-Pfad können auch mit `get CMS url` ermittelt werden, beispielsweise `/fhem/fhem-cms/CMS/index.html`. Jedes Device bildet eine eigene CMS-Inhaltsstruktur mit genau einer `index.html` als Einstiegspunkt ab; weitere Inhaltsseiten wie `urlaub.html` werden später darin angelegt und über die Navigation verlinkt.

Die `controls_fhem-cms.txt` wird aus den installierbaren Dateien unter `FHEM/` und `www/fhem-cms/` erzeugt. Der repositorybezogene Dateiname vermeidet Kollisionen mit Controls-Dateien anderer Update-Quellen auf demselben FHEM-Server. GitHub Actions aktualisiert sie nach Änderungen auf `dev` oder `main`; sie nicht manuell bearbeiten. Die `CHANGED`-Datei im Repository-Root enthält das Änderungsprotokoll für FHEM und wird bei funktionalen Änderungen gepflegt. Eine FHEM-Installation erhält Modul, Komponenten, Styles, Skripte und weitere Frontend-Dateien gemeinsam.

Beim Löschen einer FHEMCMS-Definition mit `delete CMS` bleiben ihr Geräteordner und dessen Dateien erhalten. Zum endgültigen Entfernen dient `set CMS purge CMS` vor dem `delete`.

Bedienung, Sicherheitshinweise (`allowed`) und Fehlerbehebung stehen in der [Anwenderdokumentation](docs/ANWENDER.md).

## Branches

- `dev` ist der Entwicklungs- und Teststand.
- `main` enthält freigegebene Stände.
- Änderungen werden zuerst auf `dev` entwickelt. Nach `main` wird nur nach ausdrücklicher Freigabe veröffentlicht.

Weitere Hinweise stehen in der [Entwicklungsdokumentation](dev-docs/ENTWICKLUNG.md).

## Fragen, Fehler und Ideen

Fragen, Fehler und Ideen bitte als [GitHub-Issue](https://github.com/stapetz/fhem-cms/issues/new/choose) melden. Issues sind öffentlich sichtbar und können von Suchmaschinen gefunden werden; bitte keine Passwörter, Tokens oder Adressen posten.
