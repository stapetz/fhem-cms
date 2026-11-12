# Widget-Konfigurationsdialoge

## Bestandsaufnahme (Refs #165)

Die Dialoge enthalten unterschiedliche Aufgaben und werden nicht pauschal in
Tabs aufgeteilt. Die längeren Formulare verwenden native, per Tastatur und
Touch bedienbare `<details>`-Gruppen. Kleine oder bereits klar gegliederte
Formulare bleiben kompakt.

| Widget | Eingaben und Aufgaben | Gliederung |
|---|---|---|
| Anrufliste | Titel, FB_CALLLIST-Device, Anzahl und sichtbare Spalten | Allgemein, Datenquelle, Tabellenanzeige |
| Diagramm | Titel, Device/Reading/Quelle, Einheit und Standard-Verlauf | Allgemein, Datenquelle, Verlaufsanzeige |
| FHEM-Taster | Titel, Device/Befehl, Beschriftung und Icon | Allgemein, Datenquelle und Aktion, Darstellung |
| FHEM-Schalter | Titel, Device/Reading/An-/Aus-Befehle, Beschriftung und Icons | Allgemein, Schaltverhalten, Darstellung |
| FHEM-Schieberegler | Titel, Device, Set-Befehl und Istwert-Reading | Allgemein, Datenquelle und Steuerung |
| FHEM-Tabelle | Titel, ein oder mehrere Devices/Readings, Überschrift und Summe | Allgemein, Datenquelle und Readings, Tabellenanzeige |
| FHEM-Thermostat | Titel, Device und Temperatur-/Steuerungs-Readings | Allgemein, Datenquelle und Temperaturwerte |
| FHEM-Wert | Titel, Device/Reading, Einheit und Icon | Allgemein, Datenquelle, Darstellung |
| LinkWidget | Widgettitel, Linkraster, Linkeinstellungen und Asset-Auswahl | Widgettitel, Links und Layout |
| SolarFlow | Titel, ein oder mehrere Devices/Readings, Einheiten und Berechnung | Allgemein, Datenquelle und Readings, Darstellung und Berechnung |
| Status-Symbol | Titel, Device/Reading, Zuordnung der Reading-Werte zu Icon und Farbe | Allgemein, Datenquelle, Wertzuordnung und Darstellung |
| Uhr/Datum | Titel, Uhrdarstellung und Zusatzangaben | Kompakt; Darstellungsoptionen sind bereits in Fieldsets gruppiert |
| Freies HTML | Titel, HTML-Editor und Platzhalterhilfe | Kompakt; die optionale Hilfe ist bereits einklappbar |
| Textbaustein | Titel und Texteditor | Kompakt; eine zusätzliche Gruppierung würde keinen Suchaufwand sparen |

Die gemeinsamen Begriffe „Allgemein“, „Datenquelle“ und „Darstellung“ werden
verwendet, wo sie zum jeweiligen Widget passen. Fachliche Untergruppen behalten
ihre genaueren Bezeichnungen. Daten- und Darstellungseinstellungen bleiben
im DOM, wenn eine Gruppe geschlossen wird; der bestehende Draft-, Abbrechen-,
Validierungs- und Speichern-Ablauf bleibt unverändert. Damit werden Eingaben
nicht durch den Gruppenwechsel verworfen oder auf die Live-Konfiguration
angewendet.

Die Gruppen verwenden das native `<details>/<summary>`-Verhalten: Maus, Touch
und Tastatur (Enter/Leertaste) benötigen keine separate Tab-Steuerung. Die
Fokusmarkierung bleibt sichtbar. Geschlossene Gruppen reduzieren die anfängliche
Dialoglänge; gruppierte Formulare behalten ihre vorhandene responsive Breite und
dürfen auf schmalen Ansichten keinen horizontalen Dialog-Scroll benötigen.

## Umsetzungshinweise

- Die gemeinsamen Gruppenstile liegen in `www/fhem-cms/js/dialog-groups.js`.
- Gruppen enthalten weiterhin dieselben benannten Formularfelder und
  `data-*`-Elemente. Event-Handler und Widget-Speicherverträge werden nicht
  von der Gruppierung abhängig gemacht.
- Die Device-/Reading-Auswahl bleibt ein eigener Ablauf und wird nicht in
  zusätzliche Dialog-Tabs verschoben.
