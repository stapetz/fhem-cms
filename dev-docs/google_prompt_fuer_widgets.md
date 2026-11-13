text
Rolle & Ziel:
Du bist ein Frontend-Designer für das FHEM-Modul "fhem-cms" (01_FHEMCMS). Erstelle ein vollumfängliches, responsives „Freies HTML“-Widget für das untenstehende FHEM-Device-Listing.

1. Verbindliches Design-System & Layout-Regeln:
- Basis-Container: font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: inherit; width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 8px;
- Kopfzeile: Flexbox (space-between, align-items: center), padding-bottom: 8px, border-bottom: 1px solid rgba(128,128,128,.25). Links Titel mit Emoji (1.4rem, fett) + Untertitel (.86rem, opacity: .72). Rechts Status-Badge (border-radius: 20px, padding: 4px 12px, font-size: .8rem, font-weight: 600).
- Grid-Struktur: Responsives CSS-Grid mit grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; für den oberen Hero-Bereich und darunter für die Detail-Karten.
- Hero-Kachel: border-radius: 16px; padding: 16px; background: linear-gradient(135deg, rgba(16,185,129,.15), rgba(59,130,246,.12)); border: 1px solid rgba(16,185,129,.35); mit großem Primärwert (2.7rem, font-weight: 800), Sekundärwert (1.75rem, font-weight: 700), dynamischem Fortschrittsbalken (height: 13px, border-radius: 99px) und Sub-Pills (border-radius: 10px, background: rgba(128,128,128,.12)).
- Detail-Karten: background: rgba(128,128,128,.08); border: 1px solid rgba(128,128,128,.18); border-radius: 14px; padding: 14px; mit Karten-Header (border-bottom: 1px solid rgba(128,128,128,.2)) und Key-Value-Zeilen (justify-content: space-between, font-size: .86rem, border-bottom: 1px solid rgba(128,128,128,.1)).
- Verbindliche Farbpalette (Theme-neutral für Hell- & Dunkelmodus):
  * Grün (OK/Akku/Ertrag): #10b981 / rgba(16,185,129,.15)
  * Blau (Verbrauch/Reichweite/Ist): #3b82f6 / rgba(59,130,246,.15)
  * Orange/Gelb (PV/Laden/Soll): #f59e0b / rgba(245,158,11,.15)
  * Lila (Netz/Info): #8b5cf6 / rgba(139,92,246,.15)
  * Rot (Fehler/Bezug/Alarm): #ef4444 / rgba(239,68,68,.15)
- Fußzeile: Flexbox (space-between), font-size: .75rem, opacity: .65.

2. Technische Pflichtregeln (fhem-cms Sanitizer & Kopierbarkeit):
- Gib ausschließlich <style>...</style> und das HTML-Container-<div> zurück (KEINE HTML-Kommentare <!-- ... -->, KEIN <script>, KEIN <!DOCTYPE>/<html>/<head>).
- Formatiere alle Zeilen kurz (maximal 90 Zeichen pro Zeile), damit der Code über den Kopieren-Button vollständig und ohne Abschneiden kopiert werden kann.
- Binde Readings exakt als {{DeviceName:ReadingName|filter}} ein (round(1), int, suffix(...), default(...), map(...)). Erfinde keine Readings.
- Setze NIEMALS {{...}}-Platzhalter in class="..."-Attribute. Nutze für CSS-Zustandslogik unsichtbare Sensor-Spans mit title="{{Device:Reading}}" in Kombination mit :has([title^="-"]) oder :has([title="..."]).
- Übersetze englische Statuswerte per |map(...) ins Deutsche oder in passende Emojis (z. B. 🔒/🔓, 🔋/🪫).
- Nutze bei Bedarf animierte <svg>-Flussdiagramme oder CSS-Buttons mit data-fhem-cmd="set ...".

3. Meine konkreten Wünsche für dieses Widget:
[HIER DEINE KURZE ANFORDERUNG EINFÜGEN]

4. FHEM-Device-Listing:
[HIER DEIN FHEM-LIST EINFÜGEN]