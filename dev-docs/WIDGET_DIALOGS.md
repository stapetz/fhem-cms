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
| Solar und Energiefluss | Titel, Leistungs-/Ertragseinheiten, einzelne Device-/Reading-Quellen, benannte Ertragskarten und Summen | Allgemein, Datenquellen, Ertragskarten je Anlagenteil |
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

## Device-bezogene Vorschläge (Refs #130)

Nach einer Device-Auswahl schlagen die Dialoge nur anhand verfügbarer Readings
und Set-Möglichkeiten passende Werte vor. Die Zuordnungen sind zentral in
`www/fhem-cms/js/device-suggestions.js` beschrieben; fachlich spezialisierte
Widgets wie SolarFlow behalten ihre eigene Feldsemantik. Der Setup-Assistent
verwendet dieselben Reading-Presets für Messwert- und Temperaturdiagramm-
Vorschläge; seine zusätzliche Plausibilitätsprüfung für Luftfeuchtigkeit bleibt
erhalten.

| Widget/Feld | Vorschlag |
|---|---|
| Wert, Tabelle | Erstes verfügbares Reading aus der bekannten Reihenfolge: Temperatur, Luftfeuchtigkeit, Leistung, Energie, Batterie, Status |
| Diagramm | Temperatur unter den tatsächlich geloggten Readings |
| Status-Symbol | `state` |
| Schalter | `state` sowie ausschließlich die exakt vorhandenen `on`-/`off`-Befehle; `toggle` wird nicht als Ein-/Aus-Befehl eingesetzt |
| Taster | Einziger verfügbarer parameterloser Befehl; bei mehreren Befehlen bleibt die Auswahl offen |
| Schieberegler | Passender bekannter Slider-Befehl bzw. Istwert; bei mehreren unbekannten Möglichkeiten keine willkürliche Auswahl |
| Thermostat | Je Feld explizite Kandidaten für Isttemperatur, Solltemperatur, Ventil, Modus und Batterie; fehlende optionale Felder bleiben leer |

Fehlende oder mehrdeutige Vorschläge bleiben unausgewählt. Ein vom Anwender
geänderter Feldwert – auch ein bewusst geleertes Feld – wird bei erneuter
Device-Auswahl nicht ersetzt. Bestehende gespeicherte Werte bleiben beim Öffnen
erhalten. Nicht mehr verfügbare manuelle Werte bleiben sichtbar markiert.
Vorschläge senden keine Befehle; Set-Befehle werden erst über die vorhandene,
bestätigte Widget-Aktion ausgelöst. Ladefehler erscheinen im jeweiligen Dialog.

Beim Status-Symbol stehen zusätzlich manuell auswählbare semantische
Farbvorschläge bereit. Sie speichern keinen Gewerkestatus, sondern nur den
gewählten Hex-Farbwert; automatische Gerätekategorisierung findet nicht statt.

Die Regression `t/66_device_suggestions.html` prüft die gemeinsamen Regeln,
Presets im Setup-Assistenten und die Integration in die Device-Widgetdialoge.
Sie wird zusammen mit den anderen isolierten Chrome-Regressionen über
`node --test t/35_schema5_scaling.test.js` ausgeführt; es werden keine
FHEM-Geräte verändert.
