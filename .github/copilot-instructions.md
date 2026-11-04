# Hinweise für KI-Agenten

Vor Änderungen [`dev-docs/ENTWICKLUNG.md`](../dev-docs/ENTWICKLUNG.md) lesen.

- Das Projektziel, die dokumentierten Anforderungen und Entwicklungswissen werden in `dev-docs/ENTWICKLUNG.md` als gemeinsamer Informationsraum gepflegt.
- Anforderungen können dort im Rahmen der Entwicklung dokumentiert und angepasst werden. Prüfe sie vor der Umsetzung und halte Änderungen an Projektzielen oder Anforderungen dort fest.
- Vision und Roadmap sind Zielbild, nicht automatisch bereits implementierte oder verbindliche Details. Kläre offene Anforderungen, bevor du daraus konkrete Architektur- oder Verhaltensentscheidungen ableitest.
- Entwicklungsarbeit findet auf `dev` statt.
- `main` enthält nur ausdrücklich freigegebene Stände. Ohne konkrete Freigabe nicht nach `main` pushen, mergen oder veröffentlichen.
- Diese Anweisungen werden auf `dev` gepflegt und nicht ohne ausdrücklichen Auftrag nach `main` übernommen.
- Änderungen an FHEM-Modulen müssen die FHEM-Architektur und die Sicherheitsrichtlinien unten einhalten.
- Kommunikation mit dem Entwickler auf Deutsch.

## Perl- und FHEM-Richtlinien

- Perl-Quelldateien verwenden `use strict;` und `use warnings;`. Variablen mit `my` im kleinstmöglichen Scope deklarieren.
- Eingaben aus FHEM-Geräten und Benutzereingaben validieren, bevor sie verarbeitet, in Readings gespeichert oder protokolliert werden.
- Keine Passwörter oder API-Schlüssel im Quellcode speichern. Sensible Werte nicht in Logs ausgeben.
- Keine blockierenden Netzwerkzugriffe in FHEM: asynchrone FHEM-Funktionen wie `HttpUtils_NonblockingGet` verwenden.
- FHEM-APIs wie `Log3`, `readingsSingleUpdate` und `readingsBeginUpdate`/`readingsEndUpdate` verwenden.
- Zusätzliche CPAN-Abhängigkeiten vermeiden; vorhandene Projektkonventionen und Abhängigkeiten bevorzugen.
- Shell-Befehle mit variablen Argumenten nicht über interpolierte Shell-Zeichenketten ausführen.

## Änderungen und Prüfung

- Vorhandene Muster und den tatsächlichen Projekt-Stack prüfen, bevor neue Abhängigkeiten oder Verzeichnisstrukturen eingeführt werden.
- Für Perl-Änderungen mindestens die passende Syntaxprüfung ausführen; vorhandene Tests und projektspezifische Prüfungen ebenfalls ausführen.
- Commit-Nachrichten kurz und aussagekräftig formulieren. Bei KI-unterstützten Commits den vereinbarten `Co-authored-by`-Trailer ergänzen.
- Bei funktionalen Änderungen einen datierten Eintrag mit Überschrift und kurzer Beschreibung in der FHEM-Änderungshistorie `CHANGED` ergänzen. Beim Release die Stories in `Ready to publish` als Zeilen `S<Nr> - <Issue-Titel>` aufnehmen (siehe `dev-docs/ENTWICKLUNG.md`).
- Kanban-Workflow für die Umsetzung: Ein auf `Ready` begonnenes Issue auf `In Progress` setzen. Sobald der vereinbarte, abgrenzbare Lieferumfang implementiert, lokal geprüft und dokumentiert ist, das Issue auf `In Review` setzen, damit der Entwickler die Geräte-/FHEM-Prüfung durchführen kann. `In Review` heisst bereit zur Abnahme; eine noch ausstehende Geräteprüfung ist kein Grund, in `In Progress` zu bleiben. Bei einem ausdrücklich begrenzten Teilumfang Prüfumfang sowie ausgeschlossene/zurückgestellte Anforderungen im Issue dokumentieren und den testbaren Teil nach `In Review` geben; nicht enthaltene Folgearbeit blockiert die Abnahme nicht. Unklare Anforderungen, fehlende Freigaben oder noch nicht implementierter vereinbarter Umfang bleiben `In Progress` bzw. `Backlog`. Für ausstehende Geräte-/FHEM-Prüfung `needs-test` verwenden. Zeigt die Abnahme einen Mangel oder ein nicht erfülltes vereinbartes Kriterium, den Befund im Issue dokumentieren und es zurück auf `In Progress` setzen; nach Behebung und erneuter lokaler Prüfung wieder nach `In Review` verschieben. Nach bestätigter Abnahme `needs-test` entfernen und das offene Issue nach `Ready to publish` verschieben. Diese Spalte ist die getestete Warteschlange für das nächste `main`-Release; sie bedeutet noch nicht veröffentlicht. Vor dem Release nicht schliessen oder auf `Done` setzen. Vor der Veröffentlichung beim Erstellen des `CHANGED`-Eintrags Story-Zeilen aus diesen Issues ableiten (`S<Nr> - <Issue-Titel>`). Erst nach Veröffentlichung auf `main` enthaltene Issues schliessen; die Projektworkflows setzen geschlossene Issues auf `Done` und beim Wiederöffnen auf `Backlog`. `Closes #<Nr>` nur für die Veröffentlichung nach `main` verwenden; Entwicklungs-Commits und -PRs referenzieren Issues mit `Refs #<Nr>`. `Done` bedeutet getestet, auf `main` veröffentlicht und geschlossen.
- Nach jedem erfolgreichen Commit und Push nach `dev` in der Rückmeldung diesen Aktualisierungs-Codeblock anzeigen. Für `dev` kein `update add` als festen Schritt aufnehmen:

  ```text
  update all https://raw.githubusercontent.com/stapetz/fhem-cms/dev/controls_fhem-cms.txt
  shutdown restart
  ```

## Zugriff auf die Testinstanz

- Eine vom Entwickler ausdrücklich als Testinstanz benannte FHEM-/CMS-URL darf mit dem integrierten Browser direkt geöffnet und für vereinbarte UI- und Funktionstests verwendet werden, sofern sie aus der Browserumgebung erreichbar ist.
- Eine gemeinsame LAN-Verbindung wird nicht vorausgesetzt: Erreichbarkeit zuerst über die vom Entwickler mitgeteilte URL prüfen. Keine Hosts oder Netzbereiche scannen und keine URL erraten.
- Nur die ausdrücklich freigegebene Testinstanz verwenden, niemals ungefragt eine Produktivinstanz. Tests sind standardmässig lesend. FHEM-Befehle sowie das Anlegen, Ändern oder Löschen von Devices, Attributen und CMS-Inhalten erfordern die ausdrückliche Freigabe des Entwicklers.
- Zugangsdaten weder in Repository-Dateien noch in Logs oder Testausgaben speichern. Eine Anmeldung nicht umgehen; bei erforderlicher Authentifizierung den Entwickler um eine bereits angemeldete Browser-Sitzung bitten.

## Fragen und Änderungen

Wenn mir eine Frage gestellt wird, antworte ich mit: „folgendes dazu:“
Ich nehme zunächst keine Änderungen vor, sondern frage nach, ob diese Änderungen durchgeführt werden sollen.
