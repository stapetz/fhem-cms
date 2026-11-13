const STATUS_COLOR_PRESETS = {
  dark: [
    { role: 'lighting', label: 'Licht aktiv · Amber', color: '#ffb300' },
    { role: 'heating', label: 'Heizen · Orange', color: '#ff5722' },
    { role: 'cooling', label: 'Kühlen · Blau', color: '#2196f3' },
    { role: 'safe', label: 'Sicher/geschlossen · Grün', color: '#4caf50' },
    { role: 'warning', label: 'Offen/Alarm · Rot', color: '#f44336' },
  ],
  light: [
    { role: 'lighting', label: 'Licht aktiv · Amber', color: '#b77900' },
    { role: 'heating', label: 'Heizen · Orange', color: '#d84315' },
    { role: 'cooling', label: 'Kühlen · Blau', color: '#1565c0' },
    { role: 'safe', label: 'Sicher/geschlossen · Grün', color: '#2e7d32' },
    { role: 'warning', label: 'Offen/Alarm · Rot', color: '#c62828' },
  ],
};

export function statusColorPresets(theme) {
  return STATUS_COLOR_PRESETS[theme === 'light' ? 'light' : 'dark'];
}
