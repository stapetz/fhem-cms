# Hinweise für KI-Agenten

Vor Änderungen lesen:
1. **Führendes Zielbild** für CMS-Neuentwicklung und Refactoring:
   [`dev-docs/entwicklerdoku_und_styleguides.md`](../dev-docs/entwicklerdoku_und_styleguides.md).
2. **Projektdokumentation**: [`dev-docs/ENTWICKLUNG.md`](../dev-docs/ENTWICKLUNG.md)
   für bisherigen Stand, Sicherheitsanforderungen sowie Entwicklungs-, Test- und Freigabeprozess.

Bei abweichenden Architektur- und Designvorgaben ist der Styleguide führend.
Seine Beispiele ersetzen keine Sicherheitsprüfungen. Bestand und Nutzerdaten
schrittweise und kompatibel umstellen; beide vorhandenen
[Platzhalter-Schreibweisen](../docs/PLATZHALTER.md) beibehalten.

Details:
- Das Projektziel, die dokumentierten Anforderungen und Entwicklungswissen werden in `dev-docs/ENTWICKLUNG.md` als gemeinsamer Informationsraum gepflegt.
- Anforderungen können dort im Rahmen der Entwicklung dokumentiert und angepasst werden. Prüfe sie vor der Umsetzung und halte Änderungen an Projektzielen oder Anforderungen dort fest.
- Vision und Roadmap sind Zielbild, nicht automatisch bereits implementierte oder verbindliche Details. Kläre offene Anforderungen, bevor du daraus konkrete Architektur- oder Verhaltensentscheidungen ableitest.
- Entwicklungsarbeit findet auf `dev` statt.
- `main` enthält nur ausdrücklich freigegebene Stände. Ohne konkrete Freigabe nicht nach `main` pushen, mergen oder veröffentlichen.
- Der CMS-Branch `main` existiert bereits und enthält Version `0.1.0`; keinen weiteren Branch gleichen Namens anlegen. Ein ausdrückliches „Go" für einen neuen `main`-Release gibt den aktuellen Umfang aus `Ready to publish` frei. Den bestehenden Branch niemals löschen oder per Force-Push überschreiben; falls sich `dev` nicht nachvollziehbar und sicher integrieren lässt, vor Änderungen an `main` mit dem Entwickler klären.
- Diese Anweisungen werden auf `dev` gepflegt und nicht ohne ausdrücklichen Auftrag nach `main` übernommen.
- Nach jedem erfolgreichen `main`-Deployment Stefan ausdrücklich daran erinnern, die Dokumentation unter https://wiki.fhem.de/wiki/Fhem-cms zu aktualisieren. Bei dieser Erinnerung automatisch die lokale Kopiervorlage [`docs/fhem-cms-fhem-wiki.mediawiki`](../docs/fhem-cms-fhem-wiki.mediawiki) im aktuellen VS-Code-Workspace öffnen, nicht nur verlinken. Die Datei zuvor mit dem veröffentlichten Stand abgleichen; die Pflegepflicht steht in `dev-docs/ENTWICKLUNG.md`. Die Erinnerung ist keine automatische Veröffentlichung im FHEM-Wiki.
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
- Auf `dev` und `main` muss jedes FHEMCMS-Device die geladene Modulversion im
  Internal `VERSION` anzeigen, damit sie mit `list <Device>` geprüft werden kann.
  Beim Definieren und erneuten Definieren aus `FHEMCMS_VERSION` setzen und testen.
  `dev` verwendet eine SemVer-Version mit `-dev`, `main` die stabile Release-Version.
- Commit-Nachrichten kurz und aussagekräftig formulieren. Bei KI-unterstützten Commits den vereinbarten `Co-authored-by`-Trailer ergänzen.
- Bei funktionalen Änderungen einen datierten Eintrag mit Überschrift und kurzer Beschreibung in der FHEM-Änderungshistorie `CHANGED` ergänzen. Beim Release die Stories in `Ready to publish` als Zeilen `S<Nr> - <Issue-Titel>` aufnehmen (siehe `dev-docs/ENTWICKLUNG.md`).
- Kanban-Workflow für die Umsetzung: Ein auf `Ready` begonnenes Issue auf `In Progress` setzen. Sobald der vereinbarte, abgrenzbare Lieferumfang implementiert, lokal geprüft und dokumentiert ist, das Issue auf `In Review` setzen, damit der Entwickler die Geräte-/FHEM-Prüfung durchführen kann. `In Review` heisst bereit zur Abnahme; eine noch ausstehende Geräteprüfung ist kein Grund, in `In Progress` zu bleiben. Bei einem ausdrücklich begrenzten Teilumfang Prüfumfang sowie ausgeschlossene/zurückgestellte Anforderungen im Issue dokumentieren und den testbaren Teil nach `In Review` geben; nicht enthaltene Folgearbeit blockiert die Abnahme nicht. Unklare Anforderungen, fehlende Freigaben oder noch nicht implementierter vereinbarter Umfang bleiben `In Progress` bzw. `Backlog`. Für ausstehende Geräte-/FHEM-Prüfung `needs-test` verwenden. Zeigt die Abnahme einen Mangel oder ein nicht erfülltes vereinbartes Kriterium, den Befund im Issue dokumentieren und es zurück auf `In Progress` setzen; nach Behebung und erneuter lokaler Prüfung wieder nach `In Review` verschieben. Nach bestätigter Abnahme `needs-test` entfernen und das offene Issue nach `Ready to publish` verschieben. Diese Spalte ist die getestete Warteschlange für das nächste `main`-Release; sie bedeutet noch nicht veröffentlicht. Vor dem Release nicht schliessen oder auf `Done` setzen. Vor der Veröffentlichung beim Erstellen des `CHANGED`-Eintrags Story-Zeilen aus diesen Issues ableiten (`S<Nr> - <Issue-Titel>`). Erst nach Veröffentlichung auf `main` enthaltene Issues schliessen; die Projektworkflows setzen geschlossene Issues auf `Done` und beim Wiederöffnen auf `Backlog`. `Closes #<Nr>` nur für die Veröffentlichung nach `main` verwenden; Entwicklungs-Commits und -PRs referenzieren Issues mit `Refs #<Nr>`. `Done` bedeutet getestet, auf `main` veröffentlicht und geschlossen.
- Jeder inhaltliche Commit gehört genau zu einem Issue und enthält `Refs #<Nr>`, damit GitHub Commit und Issue verknüpft. Änderungen verschiedener Issues in derselben Datei in getrennte, möglichst unabhängige Commits aufteilen; nie unfertige Arbeit in einen Commit für ein freigegebenes Issue mischen. Issue-lose Änderungen nicht ungeprüft releasen. Wenn Commit-Inhalte vermischt oder abhängig sind, zuerst sauber trennen oder abhängige Issues gemeinsam abnehmen/freigeben; bei Unsicherheit Release anhalten.
- Nach einem ausdrücklichen Release-Go einen Release-Branch vom aktuellen `main` erstellen und ausschliesslich die issuebezogenen Commits aller im Release enthaltenen `Ready to publish`-Issues darauf cherry-picken. Niemals den gesamten `dev`-Branch mergen oder ganze Dateien aus `dev` kopieren. Vor dem Push Commit-Zuordnung Issue → Hash und vollständigen Diff des Release-Branches prüfen: Jede Änderung muss zu einem ausgewählten freigegebenen Issue oder nötigen Release-Metadaten gehören. Sobald ein Commit zu einem Issue ausserhalb von `Ready to publish` auftaucht, ein benötigter Commit fehlt oder ein Patch nicht unabhängig anwendbar ist, Veröffentlichung stoppen und den Umfang isolieren oder die Issues gemeinsam freigeben lassen.
- Vor dem Release automatisch die nächste stabile SemVer-Version anhand des letzten `main`-Stands und des tatsächlichen Releaseumfangs bestimmen: rückwärtsinkompatibel = MAJOR, neue kompatible Funktion = MINOR, nur Fehlerkorrekturen/Dokumentation = PATCH; bei gemischten Änderungen gilt die höchste Stufe. Die Versionsnummer ohne `-dev` in `FHEM/01_FHEMCMS.pm` setzen, die stabile Version in `README.md` aktualisieren und `CHANGED` mit Versionsnummer, Datum, Zusammenfassung und Story-Zeilen der tatsächlich ausgewählten Issues pflegen. Die `controls_fhem-cms.txt` generiert der vorhandene Push-Workflow automatisch; nicht von Hand bearbeiten. Nach erfolgreichem Push nur tatsächlich enthaltene Issues schliessen. Nicht enthaltene Issues bleiben offen in `Ready to publish`. Einzelheiten stehen in `dev-docs/ENTWICKLUNG.md`.
- Nach einem erfolgreichen Commit und Push nach `dev`, der nach FHEM zu übertragende
  Änderungen enthält, in der Rückmeldung diesen Aktualisierungs-Codeblock anzeigen.
  Erst anzeigen, wenn die Ueberwachung aller zum Commit gehoerenden Build-/Test-
  und Controls-Workflows abgeschlossen und erfolgreich ist. Danach die tatsaechlich
  ueber die Update-URL gelieferte Controls-Datei und die betroffenen Dateien auf
  passenden Stand, Dateigroessen und Verfuegbarkeit pruefen. Solange Workflows
  laufen, fehlschlagen oder die Update-Quelle noch veraltet ist, keinen Update-Link
  und keinen Update-Befehl ausgeben; die offene Pruefung stattdessen klar benennen.
  Bei ausschließlich internen Änderungen, die nicht nach FHEM übertragen werden
  müssen, weder einen Update-Befehl noch einen sonstigen Update-Hinweis geben.
  Für `dev` kein `update add` als festen Schritt aufnehmen.
  Bei jeder Ausgabe eines FHEM-Update-Befehls unmittelbar vor der Codebox
  das aktuelle Datum und die aktuelle Uhrzeit mit Zeitzone anzeigen.
  Dazu die tatsächlich committete Modulversion, den Zielbranch und den kurzen
  Commit-Hash nennen; Version aus `FHEMCMS_VERSION` im betreffenden Commit lesen,
  nicht aus uncommittierten Dateien ableiten.
  Format: `Stand: TT.MM.JJJJ, HH:MM Uhr (MEZ/MESZ) · Version: X.Y.Z[-dev] · Branch: dev/main · Commit: <Hash>`.
  SemVer allein unterscheidet mehrere Entwicklungsstände nicht; deshalb den
  Commit zusätzlich angeben. Nicht behaupten, dass der Commit-Hash bereits
  als Internal auf dem FHEM-Gerät verfügbar ist.
  Der Zeitstempel bezeichnet die Ausgabe des Befehls, nicht einen nachgewiesenen
  Update-Zeitpunkt auf dem FHEM-Gerät:

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
