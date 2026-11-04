# fhem-cms

Frontend zur Erstellung grafischer Oberflächen für FHEM, einschließlich freier Seiten und Inhalte wie in einem klassischen Content-Management-System.

**Aktuelle stabile Version: 0.2.0**

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

## Version

Die aktuelle stabile Version ist **0.2.0**. Die installierte Version steht im Internal `VERSION` des FHEMCMS-Devices (`list <gerät>`). Entwicklungsstände auf `dev` tragen den Suffix `-dev`; die stabile Versionsnummer wird für jeden freigegebenen `main`-Release nach SemVer erhöht.

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
