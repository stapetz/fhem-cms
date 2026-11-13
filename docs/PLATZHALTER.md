# Freies HTML und Platzhalter

Die Kachel **Freies HTML** (Menü *Einfügen*) zeigt eigenen HTML-Code an und setzt Werte aus FHEM live ein. Der Code wird bei der Anzeige bereinigt; es gibt bewusst keine Skripte.

## Platzhalter suchen statt tippen

Im Dialog der Kachel **Freies HTML** öffnet der Knopf *Platzhalter suchen und einfügen …* eine Suche: Device nach Name, Alias, Typ oder Raum suchen, ein Reading aus der Liste wählen (mit aktuellem Wert), optional einen Filter hinzufügen. Der Dialog zeigt den aktuellen Wert und fügt den Platzhalter an der Cursorposition ein. Mit dem Haken *Als Element schreiben* entsteht die Attribut-Schreibweise.

Dieselbe Suche gibt es im **Textbaustein** (Knopf `{{ }}` in der Werkzeugleiste). Dort erscheint der Platzhalter als grüner Baustein im Text; ein Klick darauf öffnet die Suche zum nachträglichen Ändern, die Entf-Taste löscht ihn. Im Textbaustein kannst du formatierten Text, Bilder und Tabellen mit Platzhaltern mischen, z. B. in einer Tabellenzelle oder mitten im Satz. Intern wird er als `{{Device:reading|filter}}` gespeichert; Filter und `@alias` funktionieren wie hier beschrieben. Das Element `device`/`reading` und die Zustandsklassen gibt es nur im freien HTML.

Unter **Einheit hinter dem Wert** kannst du wie beim Widget **Wert** eine
Einheit frei eingeben oder einen der Vorschlagsbuttons wie **°C**, **W**,
**kWh** oder **%** anklicken. Auch eigene Einheiten wie `N·m` sind möglich
(maximal 16 Zeichen, keine Steuerzeichen oder Filter-/HTML-Trennzeichen).
Die Vorschau zeigt die Einheit mit einem Leerzeichen hinter
dem Wert. Ein leeres Eingabefeld entfernt die zuvor ausgewählte Einheit; andere Filter wie
`round(1)` bleiben erhalten. Die Auswahl wird als letzter Filter
`suffix( Einheit)` gespeichert und beim erneuten Bearbeiten wiedererkannt.
Ein Wechsel ersetzt diesen letzten Einheitenfilter, statt ihn mehrfach
anzuhängen. Auch eigene Einheiten werden beim Wiederöffnen erkannt. Ein
abschließendes `suffix( Text)` mit führendem Leerzeichen wird als Einheit
behandelt; Suffixe ohne dieses Leerzeichen und nicht abschließende Filter
bleiben unverändert.
Das gilt sowohl für Textplatzhalter als auch für die Element-Schreibweise.
Es ist eine Beschriftung, keine Umrechnung von W in kW oder Wh in kWh.

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

## Schreibweise als Attribute (wie in FTUI)

Statt `{{…}}` kannst du Device und Reading auch als Attribute an ein Element schreiben. Der Inhalt des Elements wird dann durch den Wert ersetzt:

```html
<span device="Garten" reading="temperature" filter="round(1)|suffix( °C)"></span>
<div device="Lampe" reading="state" filter="map(on=An,off=Aus)"></div>
<h3 device="Garten" reading="@alias"></h3>
```

- `device` und `reading` gehören immer zusammen; eines allein wird abgelehnt.
- `filter` ist optional und hat dieselbe Syntax wie bei den Platzhaltern (mehrere Filter mit `|`).
- Das Element darf jedes erlaubte Element sein (`span`, `div`, `td`, `h3` …). Vorhandener Inhalt wird ersetzt, ein leerer Wert ergibt `–`.
- Beide Schreibweisen lassen sich frei mischen. `{{…}}` eignet sich für Werte mitten im Text und in `title`, die Attribute für eigenständige Werte.
- Die Attribute heißen bewusst `device` und `reading` (ohne `data-`).

## Filter

Filter werden mit `|` angehängt und von links nach rechts angewendet, z. B. `{{Wohnzimmer:temperature|round(1)|suffix( °C)}}`.

| Filter | Wirkung |
| --- | --- |
| `round(n)` | auf n Nachkommastellen runden (0–6) |
| `int` | Nachkommastellen abschneiden |
| `upper`, `lower` | Groß- oder Kleinschreibung |
| `default(Text)` | Text, wenn der Wert leer ist |
| `prefix(Text)`, `suffix(Text)` | Text vor oder hinter einen nicht leeren Wert setzen |
| `map(on=An,off=Aus)` oder `map(on:An,off:Aus)` | Werte ersetzen; nicht aufgeführte Werte bleiben unverändert |

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

- Struktur: `div span p h1 h2 h3 h4 h5 h6 strong b em i u small br hr ul ol li section article header footer main aside nav figure figcaption details summary dl dt dd pre code blockquote sub sup mark`
- Tabellen: `table thead tbody tfoot tr th td caption`
- Medien/Navigation: `img a iframe`
- SVG: `svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop title desc`; außerdem `<style>`.
- Attribute (immer in doppelten Anführungszeichen): `class style title colspan rowspan data-cms-class device reading filter`, außerdem `id`, passive `data-*`-/ARIA-Attribute, `role` und passende Link-/Bild-/SVG-Attribute.
- `title`, `alt`, ARIA-Attribute und `data-*` dürfen Live-Platzhalter enthalten. Sie werden als Attributtext gesetzt, niemals als HTML. `data-cms-*` ist intern reserviert; die dokumentierte Ausnahme `data-cms-class` bleibt erhalten.
- **Zusätzlich erlaubt auf dev:** HTML-Kommentare, passive Struktur wie `section`, `figure`, `details/summary`, `pre/code`, Links und Bilder sowie statisches SVG mit Formen, Pfaden, Text und lokalen Verläufen. Flex-/Grid-Layout und Farben bleiben möglich.
- **CSS-Positivliste auf dev:** Layout-/Größen-/Abstands-/Typografie-/Farb-/Rahmen-Eigenschaften, Flex/Grid, Positionierung, Scrollen, Animationen/Transitions, Filter/Backdrop-Filter, Schatten, Transformationen und SVG-Paintwerte sind erlaubt. Unbekannte Eigenschaften, Funktionen und At-Regeln werden abgelehnt. CSS-Variablen (`--name`, `var()`), `calc/min/max/clamp`, Gradienten und `drop-shadow()` bleiben möglich. Regeln unterstützen `@media`, `@supports`, `@container`, `@layer`, `@keyframes` und wie ausdrücklich freigegeben `@import`. Die genaue Eigenschafts-/Funktionsliste steht in [freehtml-css.js](../www/fhem-cms/js/freehtml-css.js).
- **Layoutschutz:** `position: relative/absolute/fixed/sticky` bleibt erlaubt; feste Elemente bleiben innerhalb der Kachel. `z-index` akzeptiert `auto` oder ganze Zahlen bis **100**, keine Variablen/Formeln. Selektoren `:hover`, `:has(...)` und Attributselektoren funktionieren; `:host`/`:host-context` sind im eigenen CSS gesperrt. `url()` und `@import` erlauben lokale Pfade oder HTTP-/HTTPS-Ressourcen; SVG-Füllungen dürfen `url(#lokaleId)` nutzen.
- **Nicht erlaubt:** `script`, Formulare, Ereignis-Attribute (`onclick` …), aktive SVG-Elemente (`foreignObject`, `use`, SVG-Animationselemente), `javascript:`, `data:`, `srcdoc`, eigene Sandbox-/Berechtigungsfreigaben und CSS-Escapes. Ungültiger Code zeigt einen Fehler beim Speichern.

```html
<style>
[data-value^="-"] { color: #f59e0b; }
[data-state="on"] { font-weight: 700; }
</style>
<div data-value="{{virtualSolar:battery_power|int}}" data-state="{{Lampe:state}}">
  {{virtualSolar:battery_power|int}} W
</div>
```

Sprungmarken `<a href="#slide1">` springen zum `id="slide1"` im selben Widget,
ohne den CMS-Seitenrouter zu verändern. `:target` markiert dieses widgetlokale
Ziel auch innerhalb des Shadow DOM. Fehlende Ziele werden sichtbar gemeldet.

### Lokale Fahrzeugkarte mit Live-Standort (dev)

```html
<div id="volvo-map" data-map="vehicle"
  data-latitude="{{MeinElch:location_latitude}}"
  data-longitude="{{MeinElch:location_longitude}}"
  data-zoom="16" style="width:100%;height:175px"></div>
```

Die Kartenansicht und Leaflet werden lokal vom CMS geladen, die Kartenkacheln
weiterhin von `tile.openstreetmap.org`. Die Karte ist **nicht offline** und die
Kachelanfragen übertragen den dargestellten Kartenbereich an OpenStreetMap.
Die Quellenangabe bleibt sichtbar. Es werden keine fremden Skripte benötigt;
die HTML-Skript-/Eventhandler-Sperre bleibt unverändert.

Ein weißes SVG-Auto markiert die Reading-Koordinaten. Bei geändertem Standort
zentriert sich die Karte auf die neue Position. Unveränderte Readingupdates
erhalten die Karteninstanz und damit manuell gewählten Zoom/Kartenausschnitt.
Die Zoomknöpfe und Verschieben per Maus/Touch sind möglich; Mausradzoom ist
deaktiviert, damit das Dashboard weiter gescrollt werden kann.
`data-zoom` erlaubt 2–19; Standard 16 zeigt die Straßenumgebung. Jedes
Karten-Div benötigt eine eindeutige `id` im Widget und eine CSS-Höhe.
Latitude -90–90 und Longitude -180–180 werden geprüft; fehlende/ungültige
Werte entfernen die alte Markierung und die Kartenkacheln mit sichtbarer
Meldung. Die Mercator-Karte deckt die Polregionen nicht vollständig ab.
Auch Kachel-Ladefehler werden sichtbar gemeldet.

### Iframes für Grafana, Wetter und Karten (dev)

```html
<iframe src="http://grafana.local:3000/d-solo/panel" width="100%" height="300"></iframe>
<iframe src="/radar/panel" loading="lazy"></iframe>
<iframe src="{{Dashboard:panelUrl}}" title="Panel"></iframe>
```

Es gibt **keine Anbieter-/Hostliste**. Statische HTTP-/HTTPS-URLs und relative
Pfade sowie einzelne URL-Readings sind erlaubt. Alle Frames erhalten die feste
Sandbox `allow-scripts` ohne `allow-same-origin`, Popups oder Topnavigation und
keinen Seiten-Referrer. `srcdoc`, eigene Sandbox und zusätzliche Berechtigungen
bleiben gesperrt. Das eingebettete Angebot kann durch `X-Frame-Options`, CSP,
Mixed-Content-Regeln oder benötigte Origin-/Storage-Rechte trotzdem blockiert
werden; der Sanitizer umgeht diese Browser-/Anbieterregeln nicht.

### OpenStreetMap-Karte (dev)

```html
<iframe
  src="https://www.openstreetmap.org/export/embed.html?bbox=1%2C2%2C3%2C4&amp;layer=mapnik"
  width="100%" height="300" frameborder="0" title="Standort"></iframe>
```

Verwende den **HTML-Einbettungscode** aus OpenStreetMap, nicht die normale
Karten-Startseite. Für OpenStreetMap ist `/export/embed.html` der passende Pfad.
Die Anzeige setzt eine Sandbox mit `allow-scripts`, ohne Originfreigabe,
Popups oder Navigation des CMS-Tabs, sowie `referrerpolicy="no-referrer"`.
`srcdoc`, Eventhandler und eigene Sandbox-/Berechtigungsfreigaben sind gesperrt.
Die Karte und externe CSS-Ressourcen kontaktieren ihre Anbieter; importierte
Stylesheets sind externe Inhalte und ihre weiteren Ressourcen werden nicht
vom CMS-Sanitizer geprüft. Die CSS-Positivliste und das `z-index`-Limit gelten
für den eigenen Code, nicht rekursiv für importierte Stylesheets. Nur
vertrauenswürdige Styles importieren; HTTP ist unverschlüsselt.

Koordinaten können numerische Reading-Platzhalter im Querystring verwenden:

```html
<iframe src="https://openstreetmap.org/export/embed.html?layer=mapnik&amp;marker={{MeinElch:location_latitude}}%2C{{MeinElch:location_longitude}}"></iframe>
```

Latitude muss zwischen -90 und 90 liegen, Longitude zwischen -180 und 180.
Ein fehlender, ungültiger oder außerhalb liegender Wert lädt keine Karte und
zeigt einen Hinweis. Domain und Einbettungspfad dürfen keine Platzhalter enthalten.
`https://openstreetmap.org{{Device:latitude}}...` ist keine gültige Einbettungs-URL.

Numerische Platzhalter sind auch in Inline-Styles möglich:

```html
<div style="width:{{MeinElch:state_batteryChargeLevel|int}}%;"></div>
```

Erlaubt sind reine Zahlen sowie die Filter `int` und `round(0)` bis `round(6)`.
Der Wert wird bei jeder Aktualisierung geprüft, bevor das Style-Attribut gesetzt
wird. Beliebiger Readingtext wird nicht als CSS eingesetzt; ungültige Werte
erzeugen einen Hinweis. Platzhalter in `<style>`-Blöcken bleiben gesperrt.
`scroll-behavior:smooth` ist erlaubt; das alte ausführbare `behavior:` nicht.

### Bilder und Links aus Readings (dev)

```html
<img src="{{MeinElch:vehicle_images_exteriorImageUrl}}" alt="Fahrzeug" width="100%">
<a href="https://example.org/" target="_blank">Informationen</a>
```

`src` und `href` akzeptieren lokale Pfade oder HTTP-/HTTPS-URLs. Ein einzelner
ungefilterter Platzhalter als gesamter Attributwert wird bei jeder Anzeige
aufgelöst und anschließend als URL geprüft. Fehlende oder ungültige Werte
werden nicht geladen; ein sichtbarer Hinweis erscheint. Mischungen aus
URL-Text und Platzhaltern oder Filtern sind nicht erlaubt. Platzhalter in
normalem Text bleiben reine Textwerte, kein HTML.

Externe Bilder verursachen Netzwerkanfragen an den Bildanbieter, übertragen
aber keinen Seiten-Referrer. Neue Tabs erhalten keinen Zugriff auf den
öffnenden CMS-Tab. `javascript:`, `data:`, protokollrelative URLs (`//...`)
und eingebettete ausführbare Inhalte bleiben gesperrt.
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
| einen Wert als Attribut (FTUI-Stil) | `<span device="Device" reading="reading" filter="round(1)"></span>` |
| den Alias eines Devices | `{{Device:@alias}}` |
| eine Farbe je nach Wert | `<div data-cms-class="Device:reading>20:warm">` |

## Fragen, Fehler und Ideen

Fragen, Fehler und Ideen bitte als [GitHub-Issue](https://github.com/stapetz/fhem-cms/issues/new/choose) melden. Issues sind öffentlich sichtbar und können von Suchmaschinen gefunden werden; bitte keine Passwörter, Tokens oder Adressen posten.
