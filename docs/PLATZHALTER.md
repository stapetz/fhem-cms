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

## Beispiel

```html
<div style="font-size:1.4em">
  {{Garten:@alias|default(Garten)}}: <b>{{Garten:temperature|round(1)|suffix( °C)}}</b>
</div>
<div>Luftfeuchte: {{Garten:humidity|int|suffix( %)}}</div>
```
