# Entwicklungsdokumentation

Diese Dokumentation richtet sich an Entwickler und KI-Agenten. Sie ist nicht für die Auslieferung an FHEM-Anwender bestimmt.

## Repositorystruktur

| Pfad | Zweck |
|---|---|
| `FHEM/` | FHEM-Modul und Integration |
| `docs/` | Anwenderdokumentation |
| `dev-docs/` | Interne Entwicklungsdokumentation |
| `.github/` | GitHub-Konfiguration und Copilot-Anweisungen |

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
- Generierte Update- und Änderungsdateien nicht von Hand pflegen. Eine FHEM-Update-Automatisierung wird erst ergänzt, wenn ihre Dateinamen und ihr Veröffentlichungsablauf festgelegt sind.

## FHEM-Module

- Moduldateien liegen unter `FHEM/`; Anwenderdokumentation gehört unter `docs/`.
- Dateiname, registrierter FHEM-Gerätetyp und Perl-Paket müssen zusammenpassen.
- Versions- und Veröffentlichungsregeln für das Modul werden dokumentiert, sobald die konkrete Modul- und Update-Strategie feststeht.
