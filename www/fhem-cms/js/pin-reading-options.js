import { PIN_READING_FIELDS, pinReadingFields } from './pin-readings.js';
import { pinPresentation } from './pin-presentation.js';
import '../components/cms-pin-badge.js';

function readingControls(dialog, type) {
  if (type === 'fhem-table') return [...dialog.querySelectorAll('.row')].map((row, index) =>
    ({control: row.querySelector('select'), key: `rows.${index}`}));
  if (type === 'fhem-solar-energy') return [...dialog.querySelectorAll('.source')].map(row => {
    const section = row.closest('[data-section]');
    const index = section ? [...dialog.querySelectorAll('[data-section]')].indexOf(section) : -1;
    return {control: row.querySelector('[data-reading]'),
      key: `${section ? `sections.${index}` : 'readings'}.${row.dataset.sourceKey}`};
  });
  if (PIN_READING_FIELDS[type]) return PIN_READING_FIELDS[type].map(key =>
    ({control: dialog.querySelector(`[name="reading-${key}"]`), key: `readings.${key}`,
      selected: type === 'thermostat' && key === 'actual'}));
  if (['fhem-value', 'fhem-switch', 'fhem-icon', 'fhem-slider', 'fhem-select'].includes(type)) {
    return [{control: dialog.querySelector('[name="reading"]'), key: 'reading', selected: type === 'fhem-value'}];
  }
  return [];
}

export function mountPinReadingOptions(dialog, widget, services = {}) {
  const choices = new WeakMap();
  let initialized = false;
  const preview = dialog.ownerDocument.createElement('fieldset');
  const legend = dialog.ownerDocument.createElement('legend');
  legend.textContent = 'Pin-Vorschau (Readingnamen, keine Livewerte)';
  const badge = dialog.ownerDocument.createElement('cms-pin-badge');
  badge.inert = true;
  preview.append(legend, badge);
  if (readingControls(dialog, widget.type).some(({control}) => control)) {
    const form = dialog.querySelector('form');
    form.insertBefore(preview, form.querySelector('.actions'));
  }
  const sync = () => {
    for (const {control, key, selected = false} of readingControls(dialog, widget.type)) {
      if (!control || choices.has(control)) continue;
      const label = dialog.ownerDocument.createElement('label');
      label.className = 'cms-pin-reading-choice';
      const checkbox = dialog.ownerDocument.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = (!initialized ? widget.showOnPin?.[key] : undefined) ?? selected;
      checkbox.dataset.showOnPin = key;
      label.append(checkbox, ' Auf Pin anzeigen');
      const name = control.closest('label');
      checkbox.setAttribute('aria-label',
        `Auf Pin anzeigen: ${control.getAttribute('aria-label') || name?.childNodes[0]?.textContent?.trim() || key}`);
      (name || control).after(label);
      choices.set(control, checkbox);
    }
    badge.presentation = {...pinPresentation({...widget, showOnPin: {}}, false, new Map(), services),
      values: readingControls(dialog, widget.type).flatMap(({control}) =>
        control?.value && choices.get(control)?.checked ? [{value: control.value, unit: ''}] : [])};
  };
  sync();
  initialized = true;
  const observer = new MutationObserver(sync);
  observer.observe(dialog, {childList: true, subtree: true});
  dialog.addEventListener('change', sync);
  return {
    apply(candidate) {
      sync();
      const fields = new Set(pinReadingFields(candidate).map(field => field.key));
      const entries = readingControls(dialog, widget.type).flatMap(({control, key, selected = false}) => {
        const checkbox = choices.get(control);
        return checkbox && fields.has(key)
          && (checkbox.checked !== selected || Object.hasOwn(widget.showOnPin || {}, key))
          ? [[key, checkbox.checked]] : [];
      });
      if (entries.length || Object.hasOwn(widget, 'showOnPin')) {
        candidate = {...candidate, showOnPin: Object.fromEntries(entries)};
      }
      return candidate;
    },
    destroy() {
      observer.disconnect();
      dialog.removeEventListener('change', sync);
    },
  };
}
