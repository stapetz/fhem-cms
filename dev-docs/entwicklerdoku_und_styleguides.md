# Entwickler-Dokumentation: FHEM Custom UI Framework (FCUI)

Dieses Dokument definiert die vollständige Architektur, die Implementierungs-Standards und die Schnittstellen-Spezifikationen für das *FHEM Custom UI Framework (FCUI)*. Dieses Framework dient als hochperformante, responsive und interaktive Alternative zu bestehenden FHEM-Frontends (wie FTUI).

Dieses Dokument ist für die zukünftige Entwicklung und das Refactoring von fhem-cms
führend. Es beschreibt das Zielbild; bestehende Funktionen und Daten werden
schrittweise und unter Wahrung ihrer Kompatibilität umgestellt. Die
[Entwicklungsdokumentation](./ENTWICKLUNG.md) beschreibt den bisherigen Stand,
Sicherheitsanforderungen und den Entwicklungs- und Freigabeprozess. Die folgenden
Codebeispiele sind Implementierungsmuster und dürfen bestehende Sicherheitsprüfungen
nicht ersetzen.

---

## 1. Technologische Kern-Architektur

Das Framework trennt die Steuerungs- und Kommunikationsebene (TypeScript/ES6) strikt von der Darstellungsebene (Web Components via Lit).

### 1.1 Core-Einbindung & Runtime
Die Bereitstellung erfolgt als natives ECMAScript-Modul (ESM). Der Endanwender bindet lediglich ein zentrales Stylesheet und das kombinierte JavaScript-Bundle im HTML-Header ein. Es ist kein clientseitiger Build-Schritt beim Endanwender erforderlich.

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>FCUI Smart Home Dashboard</title>
    
    <!-- Core-Styles & Themes -->
    <link rel="stylesheet" href="css/fhem-theme.css">
    
    <!-- Gridstack.js (Drag-and-Drop & Resizing Engine) -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gridstack@10.0.1/dist/gridstack.min.css" />
    <script src="https://cdn.jsdelivr.net/npm/gridstack@10.0.1/dist/gridstack.all.js"></script>
    
    <!-- Icons (Material Symbols Rounded) -->
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0" />
    
    <!-- FCUI Widget-Bibliothek (Kompiliertes Bundle) -->
    <script type="module" src="js/fhem-widgets.bundle.js"></script>
</head>
<body data-layout="sidebar" data-theme="dark">
    <!-- App Shell & Grid Layout folgen hier -->
</body>
</html>
```

### 1.2 Ereignisgesteuertes Pub/Sub Muster (WebSocket-Anbindung)
Um Ressourcen auf Wandtablets zu schonen, abonnieren Widgets FHEM-Readings ereignisgesteuert über einen zentralen `FhemWebSocketController`.

*   **connectedCallback():** Registriert das Widget beim Controller für Live-Updates des spezifizierten `device`. Holt zeitgleich den aktuellen Initialzustand aus dem Controller-Cache.
*   **disconnectedCallback():** Meldet das Widget beim Verlassen der Ansicht ab, um Speicherlecks (*Memory Leaks*) zu verhindern.

#### Implementierungs-Muster für ein Standard-Lit-Widget:
```javascript
import { LitElement, html, css } from 'https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js';

class FcuiIconWidget extends LitElement {
  static properties = {
    device: { type: String },
    state: { type: String },
    icon: { type: String }
  };

  constructor() {
    super();
    this.device = '';
    this.state = 'off';
    this.icon = 'lightbulb';
    this._onFhemUpdate = this.handleFhemUpdate.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.device) {
      const cached = FhemWebSocketController.getDeviceState(this.device);
      if (cached) this.state = cached;
      FhemWebSocketController.subscribe(this.device, this._onFhemUpdate);
    }
  }

  disconnectedCallback() {
    if (this.device) {
      FhemWebSocketController.unsubscribe(this.device, this._onFhemUpdate);
    }
    super.disconnectedCallback();
  }

  handleFhemUpdate(event) {
    if (event && event.state !== this.state) {
      this.state = event.state; // Lit triggert hocheffizientes UI Re-Rendering
    }
  }

  toggle() {
    const next = this.state === 'on' ? 'off' : 'on';
    FhemWebSocketController.sendCmd(`set ${this.device} ${next}`);
    this.state = next; // Sofortiges visuelles Feedback
  }
}
customElements.define('fcui-icon-widget', FcuiIconWidget);
```

---

## 2. Flexibles App-Shell-Layout System

Das Root-Layout des Frameworks unterstützt drei frei wählbare Struktur-Modi. Die Steuerung erfolgt dynamisch über das Attribut `data-layout` am `<body>`- oder `<html>`-Tag.

### 2.1 Die 3 Layout-Modi
1.  **`sidebar`:** Klassische Struktur mit fester, vertikaler Navigationsleiste links. Optimal für Desktop und Tablet-Querformat.
2.  **`topbar`:** Horizontale Navigationsleiste direkt unter dem Header. Ideal für breite Bildschirme oder kompakte Monitor-Anzeigen.
3.  **`spa` (Single Page Application):** Vollkommen nacktes Dashboard ohne globale Rahmen-Navigation. Perfekt für dedizierte Kiosk-Displays oder Wand-Tablets, bei denen die Navigation rein dezentral über Widgets gesteuert wird.

### 2.2 CSS Grid Struktur (`css/fhem-theme.css`)
```css
:root {
  --fcui-sidebar-width: 240px;
  --fcui-header-height: 60px;
  --fcui-grid-gap: 16px;
  --fcui-card-bg: #1e1e1e;
  --fcui-text: #ffffff;
  --fcui-accent: #ff9900;
  --fcui-border-radius: 16px;
}

/* --- Globale App Shell Zuweisung --- */
.fcui-app-shell {
  display: grid;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* Modus: Sidebar (Standard) */
[data-layout="sidebar"] .fcui-app-shell {
  grid-template-areas: 
    "header header"
    "sidebar main";
  grid-template-columns: var(--fcui-sidebar-width) 1fr;
  grid-template-rows: var(--fcui-header-height) 1fr;
}

/* Modus: Topbar */
[data-layout="topbar"] .fcui-app-shell {
  grid-template-areas: 
    "header"
    "topnav"
    "main";
  grid-template-columns: 1fr;
  grid-template-rows: var(--fcui-header-height) auto 1fr;
}

/* Modus: SPA */
[data-layout="spa"] .fcui-app-shell {
  grid-template-areas: 
    "header"
    "main";
  grid-template-columns: 1fr;
  grid-template-rows: var(--fcui-header-height) 1fr;
}

/* Ausblend-Logik für nicht genutzte Elemente im SPA-Modus */
[data-layout="spa"] .fcui-sidebar, 
[data-layout="spa"] .fcui-topnav,
[data-layout="spa"] .fcui-menu-toggle {
  display: none !important;
}

.fcui-header { grid-area: header; background: var(--fcui-card-bg); display: flex; align-items: center; padding: 0 16px; }
.fcui-sidebar { grid-area: sidebar; background: var(--fcui-card-bg); border-right: 1px solid rgba(255,255,255,0.05); }
.fcui-main-content { grid-area: main; padding: var(--fcui-grid-gap); overflow-y: auto; -webkit-overflow-scrolling: touch; }
```

### 2.3 Responsives Verhalten & Hamburger-Menü
Im aktuellen Schema-5-Renderer werden Homepage und Vorschau anhand der
CMS-Inhaltsbreite umgebrochen: unter 768 Pixeln ein normales oder zwei kleine
Widgets, von 768 bis unter 1200 Pixeln vier Teilspalten, danach gespeicherte
Desktoppositionen. Klein bedeutet höchstens ein Viertel der gespeicherten
Rasterbreite. Reflow verändert keine Konfiguration; der Editor behält sein
präzises Raster, Geräte-Vorschau und Drehen zeigen den responsiven Umbruch.
Dies implementiert noch nicht die folgenden App-Shell-/Drawer-Zielmodi.

Sobald die Viewport-Breite **`768px`** unterschreitet (Smartphones oder Tablets im engen Hochformat), schaltet das System unabhängig vom gewählten Layout (`sidebar` oder `topbar`) in den mobilen Modus:
*   Die globale Navigationsleiste wird aus dem Grid ausgekoppelt und als verborgener Drawer (`transform: translateX(-100%)`) links platziert.
*   Das **Hamburger-Icon** (`.fcui-menu-toggle`) im Header wird sichtbar. Ein Klick darauf schiebt die Navigation als Overlay flüssig in den Bildschirm.

---

## 3. Interaktiver Bearbeitungsmodus (Drag-and-Drop & Resize)

Der Bearbeitungsmodus schaltet die Oberfläche von einem statischen Zustand in ein dynamisch veränderbares Grid auf Basis von **Gridstack.js** (standardmäßig 12 Spalten).
Unter **Bearbeiten → Seiteneinstellungen** lässt sich die Schema-5-Rasterdichte
deviceweit auf 12, 24, 48, 96 oder 192 Spalten einstellen. Positionen und Größen aller
Seiten samt Navigation werden proportional umgerechnet; beim Vergröbern werden
sie gerundet und Kollisionen nach unten aufgelöst. Die Änderung bleibt bis zum
Speichern eine lokale Vorschau und wird anschließend als Entwurf übernommen.

Für bestehende CMS-Layouts gilt die abgestimmte Übergangsregel: Ihre
48-Spalten-Koordinaten und Bearbeitbarkeit bleiben erhalten; neue FCUI-Layouts
nutzen das 12-Spalten-Raster. Eine automatische verlustbehaftete Umrechnung
findet nicht statt. Bestehende Instanzen sollen später ausdrücklich auf das
neue Format umgestellt werden können; diese Funktion ist noch nicht umgesetzt.
Nicht exakt darstellbare Positionen und Breiten sind in einer Vorschau zu
kennzeichnen und manuell anzupassen; ohne Bestätigung bleiben die alten Daten
unverändert. Ein vorhandener Entwurf muss vor der Umstellung ausdrücklich
veröffentlicht oder verworfen werden; die Umstellung selbst erledigt dies nicht.
Die Auswahl der Layout-Engine gilt für das gesamte CMS-Device; alte und neue
Layoutformate werden innerhalb einer Instanz nicht gemischt. Einzelheiten und
noch ausstehende Implementierungsschritte
stehen in der [Entwicklungsdokumentation](./ENTWICKLUNG.md#fcui-übergangsarchitektur).

### 3.1 Implementierungs-Muster & JSON-Export
Im aktiven Bearbeitungsmodus (`.fcui-edit-active`) wird der CSS-Selektor genutzt, um die Kacheln visuell zu verändern (gestrichelter Rahmen, verschiebbarer Mauszeiger). Über das Abspeichern des Grids wird ein JSON-Array extrahiert, das an FHEM zurückgegeben werden kann.

```javascript
let fhemGrid = GridStack.init({
  column: 12,
  cellHeight: '70px',
  margin: 12,
  staticGrid: true // Standardmäßig gesperrt
});

function toggleEditMode(activate) {
  fhemGrid.setStatic(!activate);
  if (activate) {
    document.body.classList.add('fcui-edit-active');
  } else {
    document.body.classList.remove('fcui-edit-active');
  }
}

function saveLayoutToFhem() {
  const currentLayout = fhemGrid.save(false);
  // Sendet das kompakte Positions-Array an FHEM zur dauerhaften Ablage
  FhemWebSocketController.sendCmd(`set d_fcui_layout layout ${JSON.stringify(currentLayout)}`);
  toggleEditMode(false);
}
```

---

## 4. Freies HTML-Widget & Universelles Navigations-Widget

### 4.1 Freies HTML-Widget (`fcui-html-widget`)
Um benutzerdefiniertes HTML analog zu FTUI einzubinden, deaktiviert dieses Widget
gezielt das Shadow DOM. Dadurch fließen globale CSS-Klassen und Theme-Variablen in
das Widget. Der zulässige HTML- und CSS-Umfang bleibt durch die unten genannte
Sicherheitsgrenze eingeschränkt.

Die bisherige Sicherheitsgrenze bleibt auch im Light DOM bestehen: Erlaubtes HTML
wird serverseitig validiert und clientseitig bereinigt; Skripte und Ereignisattribute
werden nicht ausgeführt. FHEM-Werte werden als Text, nicht als HTML eingesetzt.
Das Beispiel zeigt nur die Rendering-Struktur, nicht die erforderliche Validierung.

```javascript
class FcuiHtmlWidget extends LitElement {
  // Deaktiviert die Kapselung -> Rendert direkt im normalen Seiten-DOM (Light DOM)
  createRenderRoot() {
    return this; 
  }
  render() {
    return html`<slot></slot>`;
  }
}
customElements.define('fcui-html-widget', FcuiHtmlWidget);
```

#### Bestehende Platzhalter beibehalten

FHEM-Werte können im Textbaustein und im freien HTML an beliebigen unterstützten
Textpositionen mit `{{Device:reading|filter}}` eingefügt werden. Der Filter ist
optional; mehrere Filter können kombiniert werden. Im freien HTML ist zusätzlich
die Elementvariante möglich:

```html
<span device="Garten" reading="temperature" filter="round(1)"></span>
```

Dabei müssen `device` und `reading` gemeinsam angegeben werden; der Elementinhalt
wird durch den Wert ersetzt. Beide Schreibweisen dürfen im freien HTML gemischt
werden. Die Elementvariante ist dort verfügbar, nicht im Textbaustein. Auch
Suchdialog, Filter, Alias- und Kanalauflösung sowie Live-Aktualisierung bleiben
erhalten. Zulässige Elemente, Attribute und weitere Grenzen stehen in der
[Platzhalter-Dokumentation](../docs/PLATZHALTER.md).

### 4.2 Universelles Navigations-Widget (`fcui-nav-widget`)
Dieses Widget kann vom Benutzer frei an jeder Stelle im Grid platziert werden, um komplexe Navigationsstrukturen innerhalb von Seiten oder Absprünge ins Web zu realisieren.

*   **Attribute:**
    *   `href`: Ziel-URL oder interne Raum-ID (z. B. `http://fhem-server:8083` oder `#wohnzimmer`).
    *   `target-type`: `internal` (schaltet per JS-Routing die Ansicht um) oder `external` (klassischer Hyperlink).
    *   `open-in`: `same` (Öffnet im aktuellen Fenster/Tab -> Standard) oder `new` (Öffnet in einem neuen Browser-Tab via `_blank`).

#### Quellcode:
```javascript
class FcuiNavWidget extends LitElement {
  static properties = {
    href: { type: String },
    targetType: { type: String, attribute: 'target-type' },
    openIn: { type: String, attribute: 'open-in' },
    icon: { type: String }
  };

  static styles = css`
    .nav-card {
      background: var(--fcui-card-bg);
      border-radius: var(--fcui-border-radius);
      padding: var(--fcui-grid-gap);
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      text-decoration: none;
      color: var(--fcui-text);
      transition: transform 0.1s ease, background-color 0.2s ease;
    }
    .nav-card:active { transform: scale(0.97); }
    .icon { color: var(--fcui-accent); font-size: 24px; }
  `;

  render() {
    const targetWindow = this.openIn === 'new' ? '_blank' : '_self';
    
    return html`
      <a class="nav-card" href="${this.href}" target="${targetWindow}" @click="${this.handleNavigation}">
        <span class="material-symbols-rounded icon">${this.icon}</span>
        <div class="label"><slot></slot></div>
      </a>
    `;
  }

  handleNavigation(e) {
    if (this.targetType === 'internal' && this.openIn !== 'new') {
      e.preventDefault();
      // Interner Single-Page-Router-Aufruf
      window.fcuiRouter.navigateTo(this.href);
    }
  }
}
customElements.define('fcui-nav-widget', FcuiNavWidget);
```

---

## 5. UI/UX Styleguide

Ein kompromisslos stabiles und ergonomisches Dashboard basiert auf strikten Gestaltungsregeln.

### 5.1 Informationsdichte (Die Zwei-Zeilen-Regel)
Standard-Kacheln dürfen den Nutzer nicht mit Text überladen. Jede Karte ist strikt hierarchisch aufgebaut:
1.  **Zeile 1 (Primär):** Name des Geräts/Gewerks (z. B. *Stehlampe*) -> Fett, Schriftgröße `15px`.
2.  **Zeile 2 (Sekundär):** Statuswert oder Sensor-Reading (z. B. *Eingeschaltet - 42W*) -> Matt/gedimmt, Schriftgröße `12px`.

### 5.2 Touchscreen-Optimierung für Wandtablets
*   **Mindest-Interaktionsfläche:** Kein klickbares Element oder Steuerung darf eine physische Touch-Fläche von weniger als **`48px × 48px`** aufweisen, um Fehlbedienungen an der Wand zu minimieren.
*   **Visuelles Klick-Feedback:** Jedes interaktive Element muss bei Berührung (`:active`) unverzüglich über CSS herunterskaliert werden (`transform: scale(0.96)`). Dieses haptisch-visuelle Feedback muss stattfinden, noch bevor das WebSocket-Event den Server erreicht hat, um Mehrfachtips ungeduldiger Nutzer zu unterbinden.

### 5.3 Semantische Farb-Zustände nach Gewerken
Aktive Zustände verändern flächig die Hintergrundbeleuchtung oder die Farbintensität des zugehörigen Icons:
*   💡 **Beleuchtungs-Gewerk:** Kräftiges, warmes Amber/Gelb (`#ffb300`) für aktive Leuchtmittel.
*   🌡️ **Klima / Heizungs-Gewerk:** Signal-Orange/Rot (`#ff5722`) im aktiven Heizmodus, kühles Blau (`#2196f3`) im Kühlmodus.
*   🔒 **Sicherheits-Gewerk (Fenster, Türen, Alarme):** Sattes Grün (`#4caf50`) für geschlossene/sichere Zustände, Warn-Rot (`#f44336`) für offene Kontakte oder anstehende Alarme.
