# Usability-Leitfaden für fhem-cms

Dieser Leitfaden überträgt die UX-Vorgaben auf die vorhandene Architektur und
den tatsächlichen Entwicklungsstand von fhem-cms. Die verbindlichen
Gestaltungsregeln stehen im [führenden Styleguide](./entwicklerdoku_und_styleguides.md);
dieses Dokument beschreibt deren Anwendung, Abnahme und offene, noch zu
priorisierende Themen.

## Geltungsbereich und Leitlinien

fhem-cms verbindet redaktionelle Inhalte mit Live-Daten und – für freigegebene
Widgets – FHEM-Steuerung. Die Oberfläche richtet sich daher sowohl an
Administratoren und Redakteure als auch an Bewohner, die Seiten auf Phone,
Tablet oder Wanddisplay bedienen. Die wichtigsten Prinzipien sind:

1. **Systemstatus erkennen:** Lade-, Verbindungs-, Entwurfs-, Erfolgs- und
   Fehlerzustände werden zeitnah und verständlich angezeigt. Unbekannte oder
   veraltete Werte werden nicht wie bestätigte Live-Werte dargestellt.
2. **Begriffe und Abläufe sind vorhersehbar:** Aktionsbeschriftungen benennen
   das Ergebnis; Navigation, Dialoge, Bedienelemente und Zustandsdarstellung
   verhalten sich über Widgets hinweg konsistent.
3. **Fehler vermeiden und korrigieren:** Eingaben werden verständlich
   beschriftet und am passenden Ort validiert. Abbruch, Rückmeldung und – wo
   vereinbart – Rückgängig-Machen schützen vor unbeabsichtigtem Datenverlust.
4. **Schrittweise Komplexität:** Hauptansichten zeigen die für die aktuelle
   Aufgabe nötigen Informationen. Erweiterte Einstellungen werden im Dialog
   geordnet angeboten, ohne eine starre Tab-Anzahl oder ein bestimmtes
   Implementierungsmuster vorauszusetzen.
5. **Bestehendes erhalten:** Neue Interaktionen dürfen gespeicherte Layouts,
   Konfigurationen, beide Platzhalter-Schreibweisen, Berechtigungsprüfungen und
   bewährte Nutzerabläufe nicht stillschweigend brechen. Migration und Änderungen
   an Datenverträgen sind separat abzustimmen und zu testen.

## Verbindliche Anwendung

### Bearbeiten, Vorschau und Live-Bedienung

- Bearbeitungsmodus, Vorschau und veröffentlichte Ansicht müssen visuell und
  funktional unterscheidbar bleiben. Ein sichtbarer Entwurfsstatus macht
  Änderungen gegenüber dem Live-Stand nachvollziehbar.
- Steuerungswidgets lösen im Bearbeitungsmodus keine realen FHEM-Befehle aus.
  Sie zeigen stattdessen eine erkennbare Vorschau oder erklären, dass die
  Steuerung in der Live-Ansicht erfolgt.
- Eine sofortige visuelle Reaktion auf eine Steueraktion darf den bestätigten
  FHEM-Zustand nicht vortäuschen: Während der Anfrage ist sie als ausstehend
  erkennbar. Erfolg wird erst nach Rückmeldung bestätigt; Fehler und
  Verbindungsabbruch bleiben sichtbar und der tatsächliche Zustand wird erneut
  geladen.
- Asset-Uploads und -Löschungen wirken unabhängig vom Entwurf. Der Assetmanager
  weist vor der Nutzung gut sichtbar darauf hin; beim Löschen bleiben
  Verwendungsprüfung und eine konkrete Bestätigung erhalten.
- Destruktive Aktionen beschreiben ihre konkrete Auswirkung und verwenden den
  für den jeweiligen freigegebenen Ablauf festgelegten Bestätigungsweg. Die
  allgemeine UX-Regel ist keine Erlaubnis, einen bereits abgestimmten Ablauf
  wie `layoutupgrade` eigenmächtig zu verändern.

### Touch, Tastatur und responsive Darstellung

- Für interaktive Flächen gilt mindestens `48 × 48` CSS-Pixel gemäss Styleguide.
  Alle Kernaktionen sind ohne Hover sowie mit Maus, Touch und Tastatur erreichbar.
- Fokus ist sichtbar; Controls besitzen passende Beschriftungen, zugängliche
  Namen und einen semantisch passenden Zustand. Status wird nicht allein durch
  Farbe vermittelt.
- Phone-, Tablet- und Desktop-Ansichten sind Teil der Abnahme. Auf schmalen
  Ansichten ist kein horizontales Seiten-Scrolling für Kernaufgaben erforderlich.
  Layouts passen sich dem verfügbaren Platz an, ohne wichtige Inhalte
  abzuschneiden.
- Ziehen, Vergrössern und Slider sind so zu testen, dass versehentliche
  Wertänderungen beim Scrollen vermieden werden. Touch-Emulation ersetzt keine
  Geräteprüfung, wenn eine reale Touch-Geste betroffen ist.

### Lesbarkeit, Kontrast und Inhalte

- Text und Messwerte erfüllen WCAG 2.2 AA: mindestens `4.5:1` für normalen Text
  und `3:1` für grossen Text. Farben für Zustände werden mit Text, Symbol oder
  einer weiteren visuellen Kennzeichnung ergänzt.
- Titel, Messwert, Einheit, Fehler und veralteter Zustand bleiben auch bei
  kleinen Widgetgrössen voneinander unterscheidbar. Ein automatisches Einpassen
  darf Inhalte nicht unlesbar klein machen oder relevante Angaben abschneiden.
- Formatierungsoptionen wie Rundung, Präfix oder Suffix sollen – sofern aktuelle
  Daten verfügbar sind – eine nachvollziehbare Vorschau zeigen. Die Vorschau
  erklärt, welcher Ausgangswert verwendet wird; Beispieldaten werden als solche
  gekennzeichnet.
- Gerätewerte und Nutzereingaben werden als Text dargestellt. Eine UI-Vorschau
  ist keine Ausnahme von HTML-Sanitizer, Eingabevalidierung, FHEMWEB-Rechten oder
  CSRF-Schutz.

### Fehler, Verbindungsabbruch und Wiederherstellung

- Fehlerhinweise nennen in verständlicher Sprache den betroffenen Vorgang und,
  soweit möglich, den nächsten sicheren Schritt. Technische Details und sensible
  Daten gehören nicht in die Oberfläche oder Logs.
- Bei Verbindungsverlust bleiben alte Werte als veraltet erkennbar; nach der
  Wiederverbindung wird der aktuelle Zustand erneut gelesen. Ein fehlgeschlagener
  Schreib- oder Speichervorgang darf nicht als Erfolg erscheinen.
- Bei fehlenden Devices oder Readings, leeren Daten und nicht unterstützten
  Zuständen bleibt die Oberfläche bedienbar und erklärt die Einschränkung,
  statt falsche Standardwerte oder leere, scheinbar gültige Steuerelemente
  anzuzeigen.

## Abnahmecheckliste für UI-Änderungen

Die für eine Änderung zutreffenden Punkte sind in Testnotizen oder dem
zugehörigen Issue nachvollziehbar zu prüfen:

- [ ] Desktop, Tablet und Phone geprüft; auf schmaler Breite kein erforderliches
      horizontales Scrollen und keine abgeschnittenen Kerninhalte.
- [ ] Kernaktionen mit Maus, Touch und Tastatur erreichbar; sichtbarer Fokus,
      zugängliche Namen und mindestens `48 × 48` CSS-Pixel grosse Touch-Ziele.
- [ ] Relevante Zustände geprüft: Laden, Erfolg, Fehler, leere Daten,
      Verbindungsabbruch, Wiederverbindung und veraltete Werte.
- [ ] Bearbeiten, Vorschau und Live geprüft; kein unbeabsichtigter FHEM-Befehl,
      keine Verwechslung von Draft und Live.
- [ ] Für Nutzereingaben, FHEM-Werte, HTML und Geräteaktionen die vorhandenen
      Sicherheits- und Berechtigungsprüfungen beibehalten; keine ungeschützten
      DOM-Updates mit `innerHTML`.
- [ ] Bestehende Daten, Raster, Platzhalter und benachbarte Abläufe bleiben
      kompatibel; Regressionstests und gegebenenfalls Geräteprüfung sind
      festgehalten.

Eine Geräte-/FHEM-Prüfung ist nötig, wenn die Änderung deren Verhalten betrifft;
sie ersetzt keine passenden automatisierten Regressionstests. Referenzgeräte,
Browsermatrix und Testergebnisse werden gemäss
[Entwicklungsdokumentation](./ENTWICKLUNG.md) dokumentiert.

## Offene Usability-Themen zur Issue-Triage

Die folgenden Vorschläge aus dem zugrunde gelegten Infoblock sind überwiegend
bereits als offene GitHub-Issues angelegt (Bestandsabgleich am 12.11.2026).
Sie sind Themenvorschläge, keine
Freigabe zur Umsetzung. Ein neues Issue soll nur angelegt werden, wenn der
Abgleich mit diesen Einträgen eine eigenständige, nicht bereits erfasste
Anforderung ergibt.

| Thema aus dem Infoblock | Bestehendes Issue | Hinweis zur Abgrenzung |
|---|---:|---|
| Historische Diagramme ohne blockierende Abfragen | [#142](https://github.com/stapetz/fhem-cms/issues/142) | Ladezustand, Fehler und Performance gemeinsam abnehmen. |
| Widgets/Seiten duplizieren und Vorlagen | [#143](https://github.com/stapetz/fhem-cms/issues/143) | Device-Ersetzung und Erhalt des Entwurfs präzisieren. |
| Bedingte Sichtbarkeit | [#144](https://github.com/stapetz/fhem-cms/issues/144) | Editierbarkeit, Live-Reflow und fehlende Readings klären. |
| Wertelisten und Dropdown-Steuerungen | [#145](https://github.com/stapetz/fhem-cms/issues/145) | Nur explizit unterstützte Set-Werte anbieten. |
| Interne Seiten und Widgets als Modal-Inhalt | [#157](https://github.com/stapetz/fhem-cms/issues/157) | Folgeumfang; bestehende Modal-Grundfunktion (#146) ist geschlossen. Überschneidung mit #31 vor Umsetzung klären. |
| FHEM-gesteuerte Kiosk-Aktionen | [#147](https://github.com/stapetz/fhem-cms/issues/147) | Client-Zuordnung, Berechtigungen und Nutzerinteraktion abstimmen. |
| Assetmanager-Suche und Filter | [#126](https://github.com/stapetz/fhem-cms/issues/126) | Als spätere Version vorgemerkt; Lösch-/Uploadwirkung bleibt sofort sichtbar. |

Weitere offene, klar usability-relevante Issues, die bei der Triage
mitberücksichtigt werden sollten:

- [#152](https://github.com/stapetz/fhem-cms/issues/152): Lesbarkeit und
  Darstellung in Tabellen und Textwidgets; Umfang einer globalen Schriftgrösse
  ist ausdrücklich noch abzustimmen.
- [#160](https://github.com/stapetz/fhem-cms/issues/160): Formatierungsoptionen
  in Widget-Dialogen live vorschauen.
- [#161](https://github.com/stapetz/fhem-cms/issues/161): Entwurfsstatus
  dauerhaft und eindeutig anzeigen.
- [#162](https://github.com/stapetz/fhem-cms/issues/162): Kontrast und
  Zustandskennzeichnung der CMS-Themes nach WCAG prüfen.
- [#163](https://github.com/stapetz/fhem-cms/issues/163): Destruktive
  Editor-Aktionen mit zugänglichen Bestätigungsdialogen absichern.
- [#164](https://github.com/stapetz/fhem-cms/issues/164): Editor-Bedienelemente
  auf Touch- und Tastaturzugänglichkeit prüfen.
- [#165](https://github.com/stapetz/fhem-cms/issues/165):
  Widget-Konfigurationsdialoge nach Aufgaben strukturieren.
- [#166](https://github.com/stapetz/fhem-cms/issues/166):
  Informationshierarchie kompakter Smart-Home-Widgets vereinheitlichen.
- [#167](https://github.com/stapetz/fhem-cms/issues/167): Smart-Home-Zustände
  mit konsistenter semantischer Farbgebung darstellen.
- [#130](https://github.com/stapetz/fhem-cms/issues/130) und
  [#156](https://github.com/stapetz/fhem-cms/issues/156): passende Geräte-,
  Reading- und Widget-Vorschläge; gemeinsame Vorschlagslogik und Wizard nicht
  doppelt spezifizieren.
- [#131](https://github.com/stapetz/fhem-cms/issues/131): Widgets im
  Bearbeitungsmodus zugänglich löschen.
- [#154](https://github.com/stapetz/fhem-cms/issues/154): Undo/Redo für
  Bearbeitungsschritte; Daten- und Entwurfsgrenzen festlegen.
- [#19](https://github.com/stapetz/fhem-cms/issues/19): verschachtelte
  Navigation; Tastatur- und Touch-Bedienung gemeinsam prüfen.
- [#134](https://github.com/stapetz/fhem-cms/issues/134): automatisch
  ergänzte Temperaturverläufe im Einrichtungsassistenten; mit #142 hinsichtlich
  Abfrage und Ladezustand abgrenzen.

Der Infoblock enthält ausserdem Architektur- und Codebeispiele, Versions- und
Schemaannahmen sowie eine vorgeschlagene Roadmap. Diese Details sind nicht
automatisch Projektentscheidungen: Vor Umsetzung gelten der aktuelle
Repository-Vertrag, die Sicherheitsanforderungen, der Styleguide und die
Freigabe im jeweiligen Issue.
