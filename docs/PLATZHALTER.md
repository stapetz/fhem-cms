# Freies HTML und Platzhalter

Die Kachel **Freies HTML** (Menü *Einfügen*) zeigt eigenen HTML-Code an und setzt Werte aus FHEM live ein. Der Code wird bei der Anzeige bereinigt; es gibt bewusst keine Skripte.

## Platzhalter

Ein Platzhalter hat die Form `{{Device:reading}}`:

| Platzhalter | Ergebnis |
| --- | --- |
| `{{Wohnzimmer:temperature}}` | Wert des Readings `temperature` des Devices `Wohnzimmer` |
| `{{Wohnzimmer:@alias}}` | Alias des Devices (ohne Alias leer) |
| `{{Wohnzimmer:@name}}` | technischer Name des Devices |
| `{{Wohnzimmer:@type}}` | Typ des Devices |

- **Device einbinden:** Der Device-Name steht vor dem Doppelpunkt. Er muss in FHEM existieren und aus Buchstaben, Ziffern, `_`, `.` oder `-` bestehen. Es gibt keinen Suchdialog; unter dem Textfeld zeigt der Dialog die erkannten Devices. Höchstens 20 verschiedene Devices pro Kachel.
- **Reading holen:** Der Reading-Name steht hinter dem Doppelpunkt. Gesucht wird zuerst im Device selbst, danach in seinen Kanälen (z. B. bei HomeMatic).
- Ist ein Wert nicht vorhanden, erscheint `–` (oder der Wert aus `default(...)`).
- Werte werden immer als reiner Text eingesetzt, nie als HTML.
- Die Anzeige wird bei jeder Änderung des Devices aktualisiert.

## Filter

Filter werden mit `|` angehängt und von links nach rechts angewendet, z. B. `{{Wohnzimmer:temperature|round(1)|suffix( °C)}}`.

| Filter | Wirkung |
| --- | --- |
| `round(n)` | auf n Nachkommastellen runden (0–6) |
| `int` | Nachkommastellen abschneiden |
| `upper`, `lower` | Groß- oder Kleinschreibung |
| `default(Text)` | Text, wenn der Wert leer ist |
| `prefix(Text)`, `suffix(Text)` | Text vor oder hinter einen nicht leeren Wert setzen |
| `map(on=An,off=Aus)` | Werte ersetzen; nicht aufgeführte Werte bleiben unverändert |

Texte in Klammern dürfen kein `|`, `(`, `)`, `{` oder `}` enthalten.

## Zustandsklassen (Bedingungen)

Mit dem Attribut `data-cms-class` setzt ein Element eine CSS-Klasse, solange eine Bedingung stimmt. Mehrere Bedingungen trennt `;`:

```html
<style>
  .heiss { color: #ff8a80; }
  .an { color: #8fd0a8; }
</style>
<div data-cms-class="Garten:temperature>25:heiss">{{Garten:temperature}} °C</div>
<div data-cms-class="Lampe:state=on:an">{{Lampe:state|map(on=An,off=Aus)}}</div>
```

Aufbau: `Device:reading Operator Vergleichswert : Klassenname`. Operatoren: `=`, `!=`, `>`, `<`, `>=`, `<=`. Sind beide Seiten Zahlen, wird zahlenmäßig verglichen, sonst als Text (nur `=` und `!=`). Die Klassen definierst du in einem `<style>`-Element der Kachel; es gilt nur für diese Kachel.

## Erlaubter Code

- Elemente: `div span p h1 h2 h3 h4 strong b em i u small br hr ul ol li table thead tbody tr th td style`
- Attribute (immer in doppelten Anführungszeichen): `class style title colspan rowspan data-cms-class`
- `title` darf Platzhalter enthalten.
- **Nicht erlaubt:** `script`, `iframe`, Bilder, Formulare, Ereignis-Attribute (`onclick` …), Links, Kommentare, `url()`, `@import`, `position: fixed`. Eine Verletzung zeigt der Dialog beim Speichern als Fehler.
- Höchstens 20 000 Zeichen.

## Häufige Fragen

**Wie finde ich Device- und Reading-Namen?** In FHEM öffnest du das Device (Detailseite) und liest die Namen unter *Readings* ab. Es zählt die exakte Schreibweise inklusive Groß- und Kleinschreibung.

**Mehrere Devices in einer Kachel?** Ja, einfach mehrere Platzhalter mit verschiedenen Devices verwenden (höchstens 20).

**Reading eines Kanals (z. B. HomeMatic)?** Das Device wird zuerst selbst durchsucht, dann seine Kanäle. Du schreibst also nur den Namen des Hauptdevices und das Reading, z. B. `{{Heizung:desired-temp}}`.

**Warum steht dort `–`?** Das Device oder Reading existiert nicht, oder es hat (noch) keinen Wert. Mit `default(…)` legst du einen eigenen Ersatztext fest.

**Warum wird mein Code abgelehnt?** Meist ein nicht erlaubtes Element oder ein Attribut in einfachen statt doppelten Anführungszeichen. Schreibe `class="x"`, nicht `class='x'`.

## Beispiele

### 1. Einfache Werte

```html
<div>Temperatur: {{Garten:temperature}} °C</div>
```

### 2. Runden und Einheit anhängen

```html
<div style="font-size:1.6em"><b>{{Garten:temperature|round(1)|suffix( °C)}}</b></div>
<div>Luftfeuchte: {{Garten:humidity|int|suffix( %)}}</div>
```

### 3. Alias als Überschrift

```html
<h3>{{Garten:@alias|default(Garten)}}</h3>
<div>{{Garten:temperature|round(1)|suffix( °C)}}</div>
```

### 4. Zustände in Klartext übersetzen

```html
<div>Fenster: <b>{{Fenster:state|map(open=Offen,closed=Geschlossen,tilted=Gekippt)}}</b></div>
<div>Licht: {{Lampe:state|map(on=An,off=Aus)|default(unbekannt)}}</div>
```

### 5. Farbe nach Zustand

```html
<style>
  .an   { color: #8fd0a8; }
  .aus  { color: #888; }
  .warm { color: #ff8a80; }
  .kalt { color: #7fb4ff; }
</style>
<div data-cms-class="Lampe:state=on:an; Lampe:state=off:aus">
  Lampe: {{Lampe:state|map(on=An,off=Aus)}}
</div>
<div data-cms-class="Garten:temperature>=25:warm; Garten:temperature<10:kalt">
  Garten: {{Garten:temperature|round(1)|suffix( °C)}}
</div>
```

Passt keine Bedingung, bleibt die Klasse einfach weg. Die Bedingungen werden bei jeder Änderung neu geprüft.

### 6. Kleine Tabelle mit mehreren Devices

```html
<table>
  <thead><tr><th>Raum</th><th>Ist</th><th>Soll</th></tr></thead>
  <tbody>
    <tr><td>{{Wohnzimmer:@alias|default(Wohnzimmer)}}</td><td>{{Wohnzimmer:measured-temp|round(1)}}</td><td>{{Wohnzimmer:desired-temp|round(1)}}</td></tr>
    <tr><td>{{Bad:@alias|default(Bad)}}</td><td>{{Bad:measured-temp|round(1)}}</td><td>{{Bad:desired-temp|round(1)}}</td></tr>
  </tbody>
</table>
```

### 7. Liste mit Hinweis-Tooltip

```html
<ul>
  <li title="Gerät: {{Garten:@name}}">Außen: {{Garten:temperature|round(1)|suffix( °C)}}</li>
  <li>Batterie: {{Garten:battery|upper|default(?)}}</li>
</ul>
```

### 8. Text vor und hinter dem Wert nur bei vorhandenem Wert

`prefix` und `suffix` setzen den Text nur, wenn ein Wert da ist; sonst erscheint `–` (oder der Standardwert).

```html
<div>{{Garten:rain|prefix(Regen: )|suffix( mm)}}</div>
```

### 9. Zahlen im Text vergleichen

Bei `>`, `<`, `>=`, `<=` wird zahlenmäßig verglichen, wenn beide Seiten Zahlen sind. `Garten:temperature>20:warm` ist also für `20.5` wahr, für `abc` nicht.

## Kurzübersicht

| Ich möchte … | Schreibe ich so |
| --- | --- |
| einen Wert anzeigen | `{{Device:reading}}` |
| auf eine Stelle runden | `{{Device:reading\|round(1)}}` |
| eine Einheit anhängen | `{{Device:reading\|suffix( °C)}}` |
| einen Ersatz bei leerem Wert | `{{Device:reading\|default(n/a)}}` |
| Werte umbenennen | `{{Device:reading\|map(on=An,off=Aus)}}` |
| den Alias eines Devices | `{{Device:@alias}}` |
| eine Farbe je nach Wert | `<div data-cms-class="Device:reading>20:warm">` |
